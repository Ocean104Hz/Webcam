// src/pages/DigitScanner.tsx
import { useEffect, useRef, useState } from "react";
import { createWorker, type Worker, PSM } from "tesseract.js";
import type { LoggerMessage } from "tesseract.js";

interface ROIRect { x: number; y: number; w: number; h: number; }
interface RoiOverlayProps { getROI: () => ROIRect | null; }

// ✅ ใส่ URL /exec ของคุณ
const GAS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwwKTaWCfVg9ahhO40c_zRfdv4vEMSvcGECnwRREgkWgnzOQRzzxpjtmyKu_DsUOu8Y/exec";

export default function DigitScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [streaming, setStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState("");
  const [conf, setConf] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  const [testPea, setTestPea] = useState(""); // ช่องทดสอบ PEA

  const workerRef = useRef<Worker | null>(null);
  const ocrBusyRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const lastReadsRef = useRef<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [modalType, setModalType] = useState<"success" | "error">("success");

  // ======= INIT OCR =======
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const worker = await createWorker("eng", undefined, {
          logger: (m: LoggerMessage) => console.log(m),
        });
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789OIl|",
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
        if (!cancelled) {
          workerRef.current = worker;
          setReady(true);
        } else {
          await worker.terminate();
        }
      } catch (e) {
        console.error(e);
        setError("โหลด OCR ไม่สำเร็จ (tesseract.js)");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ======= CAMERA =======
  const handleToggleCamera = async () => {
    if (streaming) { stopCamera(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStreaming(true);
    } catch (e) {
      console.error(e);
      setError("ไม่สามารถเข้าถึงกล้องได้ – ต้องเปิดผ่าน HTTPS และอนุญาตสิทธิ์กล้อง");
    }
  };

  const stopCamera = () => {
    setScanning(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // ======= ROI =======
  const getROI = (): ROIRect | null => {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const roiW = Math.floor(vw * 0.7);
    const roiH = Math.floor(vh * 0.25);
    const x = Math.floor((vw - roiW) / 2);
    const y = Math.floor((vh - roiH) / 2);
    return { x, y, w: roiW, h: roiH };
  };

  // ======= OCR PASS =======
  const singleOcrPass = async () => {
    if (ocrBusyRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current, worker = workerRef.current;
    if (!video || !canvas || !worker) return;
    const roi = getROI(); if (!roi) return;

    canvas.width = Math.min(roi.w, 640);
    canvas.height = (roi.h * canvas.width) / roi.w;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, canvas.width, canvas.height);

    // ขาวดำ + เพิ่มคอนทราสต์
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data, CONTRAST = 1.15, THRESH = 160;
    for (let i = 0; i < d.length; i += 4) {
      let gray = (d[i] + d[i+1] + d[i+2]) / 3;
      gray = (gray - 128) * CONTRAST + 128;
      const v = gray > THRESH ? 255 : 0;
      d[i] = d[i+1] = d[i+2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    try {
      ocrBusyRef.current = true;
      const { data } = await worker.recognize(canvas);
      const text = (data?.text ?? "").trim();

      // Normalize → แล้วค่อยเก็บเฉพาะตัวเลข
      const normalized = text.replace(/[O]/g, "0").replace(/[Il|]/g, "1");
      const digits = normalized.replace(/[^0-9]/g, "").slice(0, 32);

      if (digits) {
        lastReadsRef.current.push(digits);
        if (lastReadsRef.current.length > 3) lastReadsRef.current.shift();

        const allSame = lastReadsRef.current.every(v => v === lastReadsRef.current[0]);
        const confNow = Math.round((data?.confidence ?? 0) * 10) / 10;

        if (allSame && confNow >= 50) {
          setResult(digits);
          setConf(confNow);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      ocrBusyRef.current = false;
    }
  };

  const handleToggleScan = () => {
    if (!streaming || !ready) return;
    setScanning(s => {
      const next = !s;
      if (next) {
        intervalRef.current = window.setInterval(singleOcrPass, 500);
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current); intervalRef.current = null;
      }
      return next;
    });
  };

  // ======= Copy & Send =======
  const copyToClipboard = async () => {
    try { await navigator.clipboard.writeText(result || ""); showModal("✓ คัดลอกแล้ว","success"); }
    catch { showModal("✗ คัดลอกไม่สำเร็จ","error"); }
  };

  const showModal = (msg: string, type: "success" | "error") => {
    setModalMessage(msg); setModalType(type); setModalOpen(true);
  };

  const sendToGoogleSheet = async (forceValue?: string) => {
    const peaToSend = ((forceValue ?? testPea) || result).trim(); // แก้ลำดับ ?? / || แล้ว
    if (!peaToSend) { showModal("ไม่มีหมายเลข PEA ที่จะส่ง", "error"); return; }

    try {
      // 👉 ยิงตรง Apps Script ด้วย text/plain เพื่อหลบ preflight/CORS
      const r = await fetch(GAS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ peaNumber: peaToSend }), // ต้องตรงกับ doPost
      });

      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const data = ct.includes("application/json") ? await r.json() : { ok:false, raw: await r.text() };

      if (!r.ok || (data as any)?.ok === false) throw new Error((data as any)?.error || (data as any)?.raw || "Request failed");
      showModal(`✓ ส่งสำเร็จ: ${peaToSend}`, "success");
    } catch (err) {
      console.error("Send error:", err);
      showModal(`✗ ส่งไม่สำเร็จ: ${String(err)}`, "error");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-3xl mx-auto grid gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">สแกนตัวเลข PEA ด้วย OCR</h1>
        {error && <div className="p-3 rounded-2xl bg-red-100 text-red-700">{error}</div>}

        <div className="relative rounded-2xl overflow-hidden shadow-md bg-black">
          <video ref={videoRef} className="w-full h-auto block" playsInline muted autoPlay />
          <RoiOverlay getROI={getROI} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleToggleCamera}
            className={`px-4 py-2 rounded-2xl shadow ${streaming ? "bg-slate-200" : "bg-slate-900 text-white"}`}>
            {streaming ? "ปิดกล้อง" : "เปิดกล้อง"}
          </button>

        <button type="button" disabled={!streaming || !ready} onClick={handleToggleScan}
            className={`px-4 py-2 rounded-2xl shadow ${scanning ? "bg-amber-100 text-amber-900" : "bg-emerald-600 text-white"} disabled:opacity-50`}>
            {scanning ? "หยุดสแกน" : "เริ่มสแกน"}
          </button>

          <button type="button" onClick={copyToClipboard} disabled={!result}
            className="px-3 py-2 rounded-2xl shadow bg-slate-100 disabled:opacity-50">
            คัดลอกผลลัพธ์
          </button>

          <button type="button" onClick={() => sendToGoogleSheet()} disabled={!result && !testPea}
            className="px-3 py-2 rounded-2xl shadow bg-blue-500 text-white disabled:opacity-50">
            ส่งผลลัพธ์
          </button>

          <span className="ml-auto text-sm opacity-70">{ready ? "OCR พร้อมใช้งาน" : "กำลังโหลด OCR..."}</span>
        </div>

        {/* ผลลัพธ์ OCR */}
        <div className="grid gap-2">
          <label className="text-sm opacity-70">ผลลัพธ์ที่อ่านได้</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-3 rounded-2xl bg-white border border-slate-200 font-mono text-lg">
              {result || "—"}
            </div>
            {conf != null && <div className="text-sm opacity-70">conf: {conf}</div>}
          </div>
        </div>

        {/* ช่องทดสอบส่งหมายเลข PEA */}
        <div className="grid gap-2 w-full">
          <label className="text-sm opacity-70">ช่องทดสอบส่งหมายเลข PEA</label>
          <div className="flex gap-2 items-center">
            <input
              value={testPea}
              onChange={(e) => setTestPea(e.target.value)}
              placeholder="พิมพ์หมายเลข PEA เพื่อทดสอบ"
              className="flex-1 p-3 rounded-2xl bg-white border border-slate-200"
            />
            <button type="button" onClick={() => setResult(testPea.trim())}
              disabled={!testPea.trim()}
              className="px-3 py-2 rounded-2xl shadow bg-slate-100 disabled:opacity-50">
              ตั้งค่าผลลัพธ์
            </button>
            <button type="button" onClick={() => sendToGoogleSheet(testPea.trim())}
              disabled={!testPea.trim()}
              className="px-3 py-2 rounded-2xl shadow bg-indigo-600 text-white disabled:opacity-50">
              ส่งจากช่องทดสอบ
            </button>
          </div>
          <p className="text-xs opacity-60">ช่องนี้ไว้ลองส่งหมายเลข PEA โดยไม่ต้องใช้กล้อง/สแกนจริง</p>
        </div>

        <canvas ref={canvasRef} className="hidden" />
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} message={modalMessage} type={modalType} />
      </div>
    </div>
  );
}

// ===== Overlay ROI =====
function RoiOverlay({ getROI }: RoiOverlayProps) {
  const [rect, setRect] = useState<ROIRect | null>(null);
  useEffect(() => {
    const update = () => setRect(getROI());
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [getROI]);
  if (!rect) return null;
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div className="rounded-2xl border-4 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
        style={{ width: "70%", height: "25%" }} />
    </div>
  );
}

// ===== Modal =====
function Modal({ open, onClose, message, type }: {
  open: boolean; onClose: () => void; message: string; type: "success" | "error";
}) {
  if (!open) return null;
  const color = type === "success"
    ? "bg-green-100 text-green-800 border-green-300"
    : "bg-red-100 text-red-800 border-red-300";
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50 p-6">
      <div className={`p-6 rounded-2xl shadow-xl border ${color} max-w-sm w-full`}>
        <p className="text-center">{message}</p>
        <button onClick={onClose} className="mt-4 w-full py-2 rounded-xl bg-slate-900 text-white">ปิด</button>
      </div>
    </div>
  );
}
