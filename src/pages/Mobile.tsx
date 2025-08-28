import { useEffect, useRef, useState } from "react";
import { createWorker, type Worker, PSM } from "tesseract.js";
import type { LoggerMessage } from "tesseract.js";

// Define interfaces for better type safety
interface ROIRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RoiOverlayProps {
  getROI: () => ROIRect | null;
}

export default function DigitScanner() {
  // Fix ref types
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [streaming, setStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState("");

  // Fix state type for conf
  const [conf, setConf] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  // Fix Worker ref type
  const workerRef = useRef<Worker | null>(null);
  const ocrBusyRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [modalType, setModalType] = useState<"success" | "error">("success");

  const sendToGoogleSheet = async () => {
    if (!result) {
      setModalMessage("ไม่มีข้อมูลที่จะส่ง");
      setModalType("error");
      setModalOpen(true);
      return;
    }

    try {
      // 🔹 เปลี่ยน URL ตรงนี้เป็น URL ของ Sheety ที่ได้มา
      const sheetyUrl =
        "https://api.sheety.co/3c71bb24fa11671f4674ec67c9e1895c/webcam/cam1";

      // 🔹 ตามโครงสร้าง Sheety ต้องใส่ object ที่หุ้ม field
      const body = {
        result: {
          value: result,
        },
      };

      const response = await fetch(sheetyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`POST failed: ${response.status}`);
      }

      setModalMessage(`✓ ส่งสำเร็จ: ${result}`);
      setModalType("success");
      setModalOpen(true);
    } catch (err) {
      console.error("Sheety error:", err);
      setModalMessage(`✗ ส่งไม่สำเร็จ: ${String(err)}`);
      setModalType("error");
      setModalOpen(true);
    }
  };

  // Initialize Tesseract worker
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const worker = await createWorker("eng", undefined, {
          logger: (m: LoggerMessage) => console.log(m),
        });
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789",
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
        setError("โหลด OCR ไม่สำเร็จ (Tesseract.js)");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Start/stop camera
  const handleToggleCamera = async () => {
    if (streaming) {
      stopCamera();
      return;
    }
    try {
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStreaming(true);
    } catch (e) {
      console.error(e);
      setError(
        "ไม่สามารถเข้าถึงกล้องได้ – ต้องใช้ HTTPS และอนุญาตสิทธิ์กล้อง"
      );
    }
  };

  const stopCamera = () => {
    setScanning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks =
        (videoRef.current.srcObject as MediaStream).getTracks() || [];
      tracks.forEach((t: MediaStreamTrack) => t.stop());
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Compute ROI rect relative to video
  const getROI = (): ROIRect | null => {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const roiW = Math.floor(vw * 0.5);
    const roiH = Math.floor(vh * 0.15);
    const x = Math.floor((vw - roiW) / 2);
    const y = Math.floor((vh - roiH) / 2);
    return { x, y, w: roiW, h: roiH };
  };

  const singleOcrPass = async () => {
    if (ocrBusyRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!video || !canvas || !worker) return;
    const roi = getROI();
    if (!roi) return;

    canvas.width = Math.min(roi.w, 640);
    canvas.height = (roi.h * canvas.width) / roi.w;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      video,
      roi.x,
      roi.y,
      roi.w,
      roi.h,
      0,
      0,
      canvas.width,
      canvas.height
    );
    const imgData = ctx.getImageData(0, 0, roi.w, roi.h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const v = avg > 160 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);

    try {
      ocrBusyRef.current = true;
      const { data } = await worker.recognize(canvas);
      const text = (data?.text ?? "").trim();
      const digits = text
        .replace(/[^0-9]/g, "")
        .slice(0, 32)
        .replace(/[^0-9OIl]/g, "")
        .replace(/[O]/g, "0")
        .replace(/[Il]/g, "1");
      if (digits) {
        setResult(digits);
        setConf(Math.round((data?.confidence ?? 0) * 10) / 10);
      }
    } catch (e) {
      console.error(e);
    } finally {
      ocrBusyRef.current = false;
    }
  };

  const handleToggleScan = () => {
    if (!streaming || !ready) return;
    setScanning((s) => {
      const next = !s;
      if (next) {
        intervalRef.current = window.setInterval(() => {
          singleOcrPass();
        }, 500);
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
      return next;
    });
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(result || "");
      setModalMessage("✓ คัดลอกแล้ว");
      setModalType("success");
      setModalOpen(true);
    } catch {
      setModalMessage("✗ คัดลอกไม่สำเร็จ");
      setModalType("error");
      setModalOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 p-4 md:p-8">
      <div className="max-w-3xl mx-auto grid gap-4">
        <h1 className="text-2xl md:text-3xl font-bold">
          สแกนตัวเลขจากกล้อง (OCR)
        </h1>
        <p className="text-sm opacity-80">
          ใช้กล้องมือถือเพื่ออ่านตัวเลขแบบเรียลไทม์ • ต้องเปิดผ่าน HTTPS •
          โฟกัสเฉพาะกรอบสี่เหลี่ยมกลางจอเพื่อความแม่นยำ
        </p>

        {error && (
          <div className="p-3 rounded-2xl bg-red-100 text-red-700 border border-red-200">
            {error}
          </div>
        )}

        <div className="relative rounded-2xl overflow-hidden shadow-md bg-black">
          <video
            ref={videoRef}
            className="w-full h-auto block"
            playsInline
            muted
            autoPlay
          />
          <RoiOverlay getROI={getROI} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleToggleCamera}
            className={`px-4 py-2 rounded-2xl shadow ${
              streaming ? "bg-slate-200" : "bg-slate-900 text-white"
            }`}
          >
            {streaming ? "ปิดกล้อง" : "เปิดกล้อง"}
          </button>

          <button
            disabled={!streaming || !ready}
            onClick={handleToggleScan}
            className={`px-4 py-2 rounded-2xl shadow ${
              scanning
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-600 text-white"
            } disabled:opacity-50`}
          >
            {scanning ? "หยุดสแกน" : "เริ่มสแกน"}
          </button>

          <button
            onClick={copyToClipboard}
            disabled={!result}
            className="px-3 py-2 rounded-2xl shadow bg-slate-100 disabled:opacity-50"
          >
            คัดลอกผลลัพธ์
          </button>

          <button
            onClick={sendToGoogleSheet}
            disabled={!result}
            className="px-3 py-2 rounded-2xl shadow bg-blue-500 text-white disabled:opacity-50"
          >
            ส่งผลลัพธ์
          </button>

          <span className="ml-auto text-sm opacity-70">
            {ready ? "OCR พร้อมใช้งาน" : "กำลังโหลด OCR..."}
          </span>
        </div>

        <div className="grid gap-2">
          <label className="text-sm opacity-70">ผลลัพธ์ที่อ่านได้</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-3 rounded-2xl bg-white border border-slate-200 font-mono text-lg">
              {result || "—"}
            </div>
            {conf != null && (
              <div className="text-sm opacity-70 whitespace-nowrap">
                conf: {conf}
              </div>
            )}
          </div>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <Tips />

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          message={modalMessage}
          type={modalType}
        />
      </div>
    </div>
  );
}

function RoiOverlay({ getROI }: RoiOverlayProps) {
  const [rect, setRect] = useState<ROIRect | null>(null);

  useEffect(() => {
    const update = () => setRect(getROI());
    update();
    const handler = () => update();
    window.addEventListener("resize", handler);
    const id = setInterval(update, 500);
    return () => {
      window.removeEventListener("resize", handler);
      clearInterval(id);
    };
  }, [getROI]);

  if (!rect) return null;

  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div
        className="rounded-2xl border-4 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
        style={{
          width: "70%",
          height: "25%",
        }}
      />
    </div>
  );
}

function Tips() {
  return (
    <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200">
      <h2 className="font-semibold mb-2">เคล็ดลับความแม่นยำ</h2>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        <li>พยายามให้ตัวเลขอยู่ในกรอบสีเขียวและกินพื้นที่จอพอสมควร</li>
        <li>แสงสว่างเพียงพอ ลดเงา/สะท้อน</li>
        <li>ตัวเลขแบบฟอนต์ชัดเจน ตรง ไม่เอียงมาก</li>
        <li>
          สามารถปรับโค้ดให้ตัดภาพเป็นขาวดำ/เพิ่มคอนทราสต์ก่อน OCR
          เพื่อผลลัพธ์ที่ดีขึ้น
        </li>
      </ul>
      <div className="mt-3 text-xs opacity-70">
        หมายเหตุ: หากต้องการอ่านบาร์โค้ด/QR โดยเฉพาะ แนะนำใช้ BarcodeDetector
        API (ถ้าบราวเซอร์รองรับ) แทน OCR เพื่อความเร็ว
      </div>
    </div>
  );
}

function Modal({
  open,
  onClose,
  message,
  type,
}: {
  open: boolean;
  onClose: () => void;
  message: string;
  type: "success" | "error";
}) {
  if (!open) return null;

  const color =
    type === "success"
      ? "bg-green-100 text-green-800 border-green-300"
      : "bg-red-100 text-red-800 border-red-300";

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
      <div
        className={`p-6 rounded-2xl shadow-xl border ${color} max-w-sm w-full`}
      >
        <p className="text-center">{message}</p>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2 rounded-xl bg-slate-900 text-white"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
