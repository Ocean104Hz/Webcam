// src/pages/DigitScanner.tsx
import { useEffect, useRef, useState } from "react";
import { createWorker, type Worker, PSM } from "tesseract.js";
import type { LoggerMessage } from "tesseract.js";

interface ROIRect { x: number; y: number; w: number; h: number; }
type ROIs = { pea: ROIRect; kwh: ROIRect };

// ✅ URL Apps Script /exec ของคุณ
const GAS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbwwKTaWCfVg9ahhO40c_zRfdv4vEMSvcGECnwRREgkWgnzOQRzzxpjtmyKu_DsUOu8Y/exec";

export default function DigitScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [streaming, setStreaming] = useState(false);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState("");            // ใช้ส่ง PEA (คงเดิม)
  const [conf, setConf] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  const [testPea, setTestPea] = useState("");          // ช่องทดสอบ (คงเดิม)

  // --- NEW: แยกค่า PEA และ kWh ---
  const [peaSerial, setPeaSerial] = useState("");
  const [kwhValue, setKwhValue]   = useState("");

  const workerRef = useRef<Worker | null>(null);
  const ocrBusyRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  const lastPeaRef = useRef<string[]>([]);
  const lastKwhRef = useRef<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [modalType, setModalType] = useState<"success" | "error">("success");

  // ให้ result = peaSerial เพื่อใช้ปุ่มส่งเดิมได้เหมือนเดิม
  useEffect(() => { setResult(peaSerial); }, [peaSerial]);

  // ======= INIT OCR =======
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const worker = await createWorker("eng", undefined, {
          logger: (m: LoggerMessage) => console.log(m),
        });
        await worker.setParameters({
          user_defined_dpi: "300",
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

  // ======= ROIs (PEA บน, kWh กลาง) =======
  const getROIs = (): ROIs | null => {
    const v = videoRef.current;
    if (!v) return null;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;

    // ปรับได้ตามกล้อง/รุ่นมิเตอร์
    const peaW = Math.floor(vw * 0.55), peaH = Math.floor(vh * 0.12);
    const peaX = Math.floor((vw - peaW) / 2);
    const peaY = Math.floor(vh * 0.12);

    const kwhW = Math.floor(vw * 0.50), kwhH = Math.floor(vh * 0.18);
    const kwhX = Math.floor((vw - kwhW) / 2);
    const kwhY = Math.floor(vh * 0.44);

    return { pea: { x: peaX, y: peaY, w: peaW, h: peaH },
             kwh: { x: kwhX, y: kwhY, w: kwhW, h: kwhH } };
  };

  // ======= OCR PASS (อ่าน 2 ROI) =======
  const singleOcrPass = async () => {
    if (ocrBusyRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current, worker = workerRef.current;
    if (!video || !canvas || !worker) return;
    const rois = getROIs(); if (!rois) return;

    const doOcr = async (roi: ROIRect, opts: { whitelist: string; invert?: boolean; psm?: PSM }) => {
      canvas.width = Math.min(roi.w * 2, 1000);
      canvas.height = Math.min(roi.h * 2, 600);
      const ctx = canvas.getContext("2d"); if (!ctx) return "";

      ctx.drawImage(video, roi.x, roi.y, roi.w, roi.h, 0, 0, canvas.width, canvas.height);

      // ขาวดำ + คอนทราสต์ + (กลับสีถ้าต้องการ)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data, CONTRAST = 1.25, THRESH = 150;
      for (let i = 0; i < d.length; i += 4) {
        let gray = (d[i] + d[i+1] + d[i+2]) / 3;
        gray = (gray - 128) * CONTRAST + 128;
        let v = gray > THRESH ? 255 : 0;
        if (opts.invert) v = 255 - v;           // ← สำคัญสำหรับ kWh (ตัวเลขขาวบนดำ)
        d[i] = d[i+1] = d[i+2] = v;
      }
      ctx.putImageData(img, 0, 0);

      await worker.setParameters({
        tessedit_char_whitelist: opts.whitelist,
        tessedit_pageseg_mode: opts.psm ?? PSM.SINGLE_WORD,
      });

      const { data } = await worker.recognize(canvas);
      return (data?.text ?? "").trim();
    };

    try {
      ocrBusyRef.current = true;

      // --- 1) PEA SERIAL (ไม่ invert) ---
      const peaRaw = await doOcr(rois.pea, { whitelist: "PEA0123456789", psm: PSM.SINGLE_LINE });
      const peaDigits =
        (peaRaw.match(/PEA\s*([0-9]{6,})/i)?.[1] ?? peaRaw.replace(/[^0-9]/g, "")).slice(0, 12);

      if (peaDigits) {
        lastPeaRef.current.push(peaDigits);
        if (lastPeaRef.current.length > 3) lastPeaRef.current.shift();
        const stable = lastPeaRef.current.every(v => v === lastPeaRef.current[0]);
        if (stable) setPeaSerial(peaDigits);
      }

      // --- 2) kWh (ตัวเลขขาวบนดำ → invert) ---
      const kwhRaw = await doOcr(rois.kwh, { whitelist: "0123456789", psm: PSM.SINGLE_WORD, invert: true });
      const kwhDigits = kwhRaw.replace(/[^0-9]/g, "").slice(0, 8);

      if (kwhDigits) {
        lastKwhRef.current.push(kwhDigits);
        if (lastKwhRef.current.length > 3) lastKwhRef.current.shift();
        const stableK = lastKwhRef.current.every(v => v === lastKwhRef.current[0]);
        if (stableK) setKwhValue(kwhDigits);
      }

      // เก็บ conf ล่าสุดไว้แสดง (จะเป็นของงานสุดท้าย)
      setConf(null); // ถ้าต้องการแสดงจริง ๆ สามารถอ่าน data.conf แล้วเก็บไว้แยกต่อ ROI ได้
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
        intervalRef.current = window.setInterval(singleOcrPass, 600);
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current); intervalRef.current = null;
      }
      return next;
    });
  };

  // ======= Copy & Send (คงของเดิม) =======
  const copyToClipboard = async () => {
    try { await navigator.clipboard.writeText(result || ""); showModal("✓ คัดลอกแล้ว","success"); }
    catch { showModal("✗ คัดลอกไม่สำเร็จ","error"); }
  };

  const showModal = (msg: string, type: "success" | "error") => {
    setModalMessage(msg); setModalType(type); setModalOpen(true);
  };

  const sendToGoogleSheet = async (forceValue?: string) => {
    const peaToSend = ((forceValue ?? testPea) || result).trim();
    if (!peaToSend) { showModal("ไม่มีหมายเลข PEA ที่จะส่ง", "error"); return; }

    try {
      // ยิงตรง Apps Script ด้วย text/plain เพื่อลดปัญหา CORS
      const r = await fetch(GAS_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ peaNumber: peaToSend /*, kWh: kwhValue*/ }),
      });

      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const data = ct.includes("application/json") ? await r.json() : { ok:false, raw: await r.text() };

      if (!r.ok || (data as any)?.ok === false)
        throw new Error((data as any)?.error || (data as any)?.raw || "Request failed");

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
          <RoiOverlay getROIs={getROIs} />
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

        {/* ผลลัพธ์ */}
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <div className="w-28 text-sm opacity-60">PEA</div>
            <div className="flex-1 p-3 rounded-2xl bg-white border border-slate-200 font-mono text-lg">
              {peaSerial || "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-28 text-sm opacity-60">kWh</div>
            <div className="flex-1 p-3 rounded-2xl bg-white border border-slate-200 font-mono text-lg">
              {kwhValue || "—"}
            </div>
          </div>
          {conf != null && <div className="text-sm opacity-70">conf (ล่าสุด): {conf}</div>}
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
            <button type="button" onClick={() => setPeaSerial(testPea.trim())}
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
          <a href="https://docs.google.com/spreadsheets/d/1iFf_KSzgvK38FRQBkUNHs49CKmdxFSiFnYPY2nSS_ww/edit?usp=sharing" className="text-xs opacity-60 t-10">ดูข้อมูลที่นี้...</a>
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} message={modalMessage} type={modalType} />
      </div>
    </div>
  );
}

// ===== Overlay แสดง 2 ROI =====
function RoiOverlay({ getROIs }: { getROIs: () => ROIs | null }) {
  const [r, setR] = useState<ROIs | null>(null);
  useEffect(() => {
    const upd = () => setR(getROIs());
    upd();
    const id = setInterval(upd, 500);
    return () => clearInterval(id);
  }, [getROIs]);
  if (!r) return null;

  // ใช้เปอร์เซ็นต์ให้เลย์เอาท์ยืดหยุ่นตามวิดีโอ
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* กรอบ PEA (เขียว) */}
      <div
        className="absolute border-4 border-emerald-400/80 rounded-2xl"
        style={{ left: "22.5%", right: "22.5%", top: "24%", height: "12%" }}
      />
      {/* กรอบ kWh (ฟ้า) */}
      <div
        className="absolute border-4 border-sky-400/80 rounded-2xl"
        style={{ left: "25%", right: "25%", top: "44%", height: "18%" }}
      />
      {/* เงามืดรอบนอก */}
      <div className="absolute inset-0 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] rounded-2xl"/>
    </div>
  );
}

// ===== Modal (คงเดิม) =====
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
