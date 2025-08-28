import { useState } from "react";
import { Link } from "react-router-dom";

export default function SimpleForm() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [status, setStatus] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const url = "https://api.sheety.co/3c71bb24fa11671f4674ec67c9e1895c/webcam/cam1";
        const body = {
            sheet1: {
                name,
                email,
                message
            }
        };

        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer 1e1b4pOkZxEwQoc3w0LpsOD2oZkQRmyd8viy4lgAjW9c"
                },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                setStatus("ส่งข้อมูลเรียบร้อย ✅");
                setName("");
                setEmail("");
                setMessage("");
            } else {
                setStatus("เกิดข้อผิดพลาด ❌");
            }
        } catch (error) {
            console.error(error);
            setStatus("เกิดข้อผิดพลาด ❌");
        }
    };

    return (
        <div className="max-w-md mx-auto p-4">
            <Link to="/" className="hover:underline px-3 py-2 rounded-2xl shadow bg-blue-500 text-white disabled:opacity-50">
                หน้าหลัก
            </Link>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <input
                    type="text"
                    placeholder="ชื่อ"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="border p-2 rounded"
                    required
                />
                <input
                    type="email"
                    placeholder="อีเมล"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="border p-2 rounded"
                    required
                />
                <textarea
                    placeholder="ข้อความ"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="border p-2 rounded"
                    required
                />
                <button type="submit" className="bg-blue-500 text-white p-2 rounded">
                    ส่งข้อมูล
                </button>
            </form>
            {status && <p className="mt-2">{status}</p>}
        </div>
    );
}
