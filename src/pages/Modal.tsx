import React from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  message: string;
  type: "success" | "error";
}

const Modal: React.FC<ModalProps> = ({ open, onClose, message, type }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        className={`bg-white rounded-2xl p-6 shadow-lg w-80 text-center ${
          type === "success" ? "border-green-500" : "border-red-500"
        } border-2`}
      >
        <h2
          className={`text-xl font-bold mb-4 ${
            type === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {type === "success" ? "สำเร็จ" : "ผิดพลาด"}
        </h2>
        <p className="mb-4">{message}</p>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-blue-500 text-white rounded-xl shadow hover:bg-blue-600"
        >
          ปิด
        </button>
      </div>
    </div>
  );
};

export default Modal;
