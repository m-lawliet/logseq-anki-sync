import ReactDOM from "react-dom";
import React from "react";
import {Modal} from "./Modal";
import {LogseqButton} from "./basic/LogseqButton";

export async function Confirm(msg: string): Promise<boolean> {
    return new Promise<boolean>(async (resolve, reject) => {
        try {
            const main = window.parent.document.querySelector("#root main");
            const div = window.parent.document.createElement("div");
            main?.appendChild(div);
            let onClose = () => {
                ReactDOM.unmountComponentAtNode(div);
                div.remove();
            }
            onClose = onClose.bind(this);
            ReactDOM.render(<ModelComponent msg={msg} resolve={resolve} reject={reject} />, div);
        } catch (e) {
            logseq.App.showMsg("Error", "Failed to open modal");
            console.log(e)
            reject(e);
        }
    });
}

const ModelComponent : React.FC<{
    msg: string;
    resolve: Function;
    reject: Function;
    onClose: () => void;
}> = ({ msg, resolve, reject, onClose }) => {
    const [open, setOpen] = React.useState(true);
    const returnResult = React.useCallback((result: boolean) => {
        resolve(result);
        setOpen(false);
    }, [resolve]);

    React.useEffect(() => {
        const onKeydown = (e: KeyboardEvent) => {
            console.log('onKeydown');
            if (e.key === "Escape") {
                returnResult(false);
            }
            else if (e.key === "Enter") {
                returnResult(true);
            }
        };
        window.parent.document.addEventListener("keydown", onKeydown);
        return () => {
            window.parent.document.removeEventListener("keydown", onKeydown);
        };
    }, [onClose]);

    React.useEffect(() => {
        if (!open) {
            returnResult(false);
        }
    }, [open]);

    return (
        <Modal open={open} setOpen={setOpen} onClose={onClose}>
            <div className="ui__confirm-modal is-">
                <div className="sm:flex sm:items-start">
                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                        <h2 className="headline text-lg leading-6 font-medium" dangerouslySetInnerHTML={{__html: msg}} />
                        <label className="sublabel">
                            <h3 className="subline text-gray-400"></h3>
                        </label>
                    </div>
                </div>
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                    <span className="flex w-full rounded-md shadow-sm sm:ml-3 sm:w-auto">
                        <LogseqButton
                            isFullWidth={true}
                            isCentered={true}
                            onClick={() => returnResult(true)}
                            color='primary'>Confirm</LogseqButton>
                    </span>
                    <span className="flex w-full rounded-md shadow-sm sm:ml-3 sm:w-auto">
                        <LogseqButton
                            isFullWidth={true}
                            isCentered={true}
                            onClick={() => returnResult(false)}>Cancel</LogseqButton>
                    </span>
                </div>
            </div>
        </Modal>
    )
}