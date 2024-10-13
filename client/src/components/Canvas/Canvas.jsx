import { useLayoutEffect, useState, useRef, useEffect } from "react";
import rough from "roughjs/bundled/rough.esm";
import Toolbar from "../Toolbar/Toolbar";
import BottomToolbar from "../BottomToolbar/BottomToolbar";
import useHistory from "../../hooks/useHistory";
import getStroke from "perfect-freehand";
import {
    cursorForPosition,
    getSvgPathFromStroke,
    adjustmentRequired,
    getElementAtPosition,
    resizedCoordinates,
    adjustElementCoordinates,
} from "./utils";
import { io } from "socket.io-client";
import Button from "../Button";
import { Save } from "lucide-react";
import axios from "axios";
import { useSelector } from "react-redux";
import { useDispatch } from "react-redux";
import { unsetID } from "../../store/canvasSlice";

function Canvas({hist}) {
    const dispatch = useDispatch();
    const [socket, setSocket] = useState(null);
    const generator = rough.generator({ stroke: "green" });

    const canvas = useSelector((state) => state.canvas);

    const [elements, setElements, undo, redo, updateState] = useHistory([]);

    const [action, setAction] = useState("none"); // only tracks mouse when action is true
    const [tool, setTool] = useState("line");
    const [selectedElement, setSelectedElement] = useState(null);
    const canvasRef = useRef(null);

    const createElement = (id, x1, y1, x2, y2, type) => {
        switch (type) {
            case "line":
            case "rectangle":
                const roughElement =
                    type === "line"
                        ? generator.line(x1, y1, x2, y2)
                        : generator.rectangle(x1, y1, x2 - x1, y2 - y1);
                return { id, x1, y1, x2, y2, type, roughElement };
            case "freedraw":
                return { id, type, points: [{ x: x1, y: y1 }] };
            default:
                throw new Error(`Unrecognized type ${type}`);
        }
    };

    const handleMouseDown = (e) => {
        const { clientX, clientY } = e;
        if (tool === "select") {
            const element = getElementAtPosition(clientX, clientY, elements);
            if (element) {
                if (element.type === "freedraw") {
                    const xOffsets = element.points.map(
                        (point) => clientX - point.x
                    );
                    const yOffsets = element.points.map(
                        (point) => clientY - point.y
                    );
                    setSelectedElement({ ...element, xOffsets, yOffsets });
                } else {
                    const offsetX = clientX - element.x1;
                    const offsetY = clientY - element.y1;
                    setSelectedElement({ ...element, offsetX, offsetY });
                }
                setElements((prev) => prev);

                if (element.position === "inside") {
                    setAction("moving");
                } else {
                    setAction("resizing");
                }
            }
        } else {
            const id = elements.length;
            const type = tool;
            const element = createElement(
                id,
                clientX,
                clientY,
                clientX,
                clientY,
                type
            );
            setElements((elements) => [...elements, element]);
            setSelectedElement(element);
            setAction("drawing");
        }
    };

    const handleMouseMove = (e) => {
        const { clientX, clientY } = e;

        if (tool === "select") {
            const element = getElementAtPosition(clientX, clientY, elements);
            e.target.style.cursor = getElementAtPosition(
                clientX,
                clientY,
                elements
            )
                ? cursorForPosition(element.position)
                : "default";
        }

        if (action === "drawing") {
            const i = elements.length - 1;

            const { x1, y1, type } = elements[i];

            updateElement(i, x1, y1, clientX, clientY, type);
        } else if (action === "moving") {
            if (selectedElement.type === "freedraw") {
                const newPoints = selectedElement.points.map((_, index) => {
                    return {
                        x: clientX - selectedElement.xOffsets[index],
                        y: clientY - selectedElement.yOffsets[index],
                    };
                });
                const elementsCopy = [...elements];
                elementsCopy[selectedElement.id] = {
                    ...elementsCopy[selectedElement.id],
                    points: newPoints,
                };
                setElements(elementsCopy, true);
            } else {
                const { id, x1, x2, y1, y2, type, offsetX, offsetY } =
                    selectedElement;
                const width = x2 - x1;
                const height = y2 - y1;
                const newX = clientX - offsetX;
                const newY = clientY - offsetY;
                updateElement(
                    id,
                    newX,
                    newY,
                    newX + width,
                    newY + height,
                    type
                );
            }
        } else if (action === "resizing") {
            const { id, type, position, ...coordinates } = selectedElement;
            const { x1, y1, x2, y2 } = resizedCoordinates(
                clientX,
                clientY,
                position,
                coordinates
            );
            updateElement(id, x1, y1, x2, y2, type);
        }
    };

    const updateElement = (id, x1, y1, x2, y2, type) => {
        const elementsCopy = [...elements];

        switch (type) {
            case "line":
            case "rectangle":
                elementsCopy[id] = createElement(id, x1, y1, x2, y2, type);
                break;
            case "freedraw":
                elementsCopy[id].points = [
                    ...elementsCopy[id].points,
                    { x: x2, y: y2 },
                ];
                break;
            default:
                throw new Error(`Unrecognized type: ${type}`);
        }
        setElements(elementsCopy, true);
    };

    const handleMouseUp = () => {
        if (selectedElement) {
            const i = selectedElement.id;
            const { id, type } = elements[i];

            if (
                (action === "drawing" || action === "resizing") &&
                adjustmentRequired(type)
            ) {
                const { x1, y1, x2, y2 } = adjustElementCoordinates(
                    elements[i]
                );
                updateElement(id, x1, y1, x2, y2, type);
            }
        }
        setAction("none");
        setSelectedElement(null);
        updateState();
    };

    useEffect(() => {}, []);

    useLayoutEffect(() => {
        // const canvas = document.getElementById("canvas");
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // const config = { stroke: "green" };

        const roughCanvas = rough.canvas(canvasRef.current);

        // elements.forEach(({ roughElement }) => roughCanvas.draw(roughElement));
        elements.forEach((element) => drawElement(roughCanvas, ctx, element));
        if (elements && elements.length > 0) {
            socket.emit("update", elements);
        }
        console.log("actual elements", elements);
    }, [elements]);

    useEffect(() => {
        const newSocket = io(import.meta.env.VITE_APP_SOCKET_URL);
        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
            dispatch(unsetID());
        };
    }, []);

    useEffect(() => {
        if (!socket) return;

        socket.on("update", (elements) => {
            console.log("Received elements:", elements);
            console.log("Type of elements:", typeof elements);
            console.log("Is array:", Array.isArray(elements));

            elements.forEach((element) => console.log(element.id, element));

            // setElements(elements)

            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const roughCanvas = rough.canvas(canvasRef.current);

            elements.forEach((element) =>
                drawElement(roughCanvas, ctx, element)
            );
        });
    }, [socket]);

    const drawElement = (roughCanvas, ctx, element) => {
        const { type } = element;
        switch (type) {
            case "line":
            case "rectangle":
                roughCanvas.draw(element.roughElement);
                break;
            case "freedraw":
                const stroke = getSvgPathFromStroke(
                    getStroke(element.points, { size: 10 })
                );
                ctx.fillStyle = "black";
                ctx.fill(new Path2D(stroke));
                break;
            default:
                throw new Error(`Unrecognized Type: ${type}`);
        }
    };

    useEffect(() => {
        const undoRedoFunction = (e) => {
            if (e.metaKey || e.ctrlKey) {
                if (e.key === "y") {
                    redo();
                } else if (e.key === "z") {
                    undo();
                }
            }
        };
        document.addEventListener("keydown", undoRedoFunction);
        return () => {
            document.removeEventListener("keydown", undoRedoFunction);
        };
    }, [undo, redo]);

    const save = () => {
        console.log(canvas);
        axios
            .patch(`/api/v1/canvas/update-canvas/${canvas.id}`, {
                history: JSON.stringify(canvas.history),
                index: canvas.index,
            })
            .then(() => console.log("canvas saved"))
            .catch((err) => console.log(err));
    };

    return (
        <div className="w-full h-full bg-dots-pattern bg-dots-size text-gray-300">
            {/* <Button onClick={saveCanvas}>Save</Button> */}
            <Toolbar setTool={setTool} />
            <div className="fixed top-2 left-10 transform -translate-x-1/2 bg-black backdrop-blur-lg rounded-lg shadow-lg">
                <Button onClick={save}>
                    <Save />
                </Button>
            </div>
            <canvas
                ref={canvasRef}
                id="canvas"
                // style={{ backgroundColor: "gray" }}
                width={window.innerWidth}
                height={window.innerHeight}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
            >
                Canvas
            </canvas>
            <BottomToolbar undo={undo} redo={redo} />
        </div>
    );
}

export default Canvas;
