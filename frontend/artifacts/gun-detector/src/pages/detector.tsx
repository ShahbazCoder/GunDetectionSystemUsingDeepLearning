import { useEffect, useRef, useState, useCallback } from "react";
import { AlertCircle, Camera, Activity, Server, History, Crosshair, MonitorPlay } from "lucide-react";

interface Detection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number;
  label: string;
}

interface LogEntry {
  id: string;
  timestamp: Date;
  label: string;
  confidence: number;
}

export default function Detector() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [modelReady, setModelReady] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [fps, setFps] = useState(0);
  const [detectionCount, setDetectionCount] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [threatDetected, setThreatDetected] = useState(false);

  const lastTimeRef = useRef<number>(Date.now());
  const animationFrameRef = useRef<number>();

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("http://192.168.0.177:8000/ai/health");
      // const res = await fetch("http://10.10.8.112:8000/ai/health");
      if (res.ok) {
        const data = await res.json();
        setModelReady(data.model_ready === true);
      }
    } catch (e) {
      setModelReady(false);
    }
  }, []);

  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720, facingMode: "user" } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setCameraActive(true);
          };
        }
      } catch (err) {
        console.error("Failed to access camera", err);
      }
    }
    setupCamera();

    // Immediately check health, then poll every 2s
    checkHealth();
    const healthCheck = setInterval(checkHealth, 2000);

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
      clearInterval(healthCheck);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const drawDetections = useCallback((detections: Detection[]) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !video || !wrapper) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas dimensions to video element dimensions exactly
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate scale between raw video size and rendered size
    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;

    let localThreat = false;
    
    detections.forEach(det => {
      if (det.label.toLowerCase().includes('gun') || det.label.toLowerCase().includes('pistol') || det.label.toLowerCase().includes('rifle') || det.label.toLowerCase().includes('firearm') || det.label.toLowerCase().includes('weapon')) {
        localThreat = true;
      }

      const x = det.x1 * scaleX;
      const y = det.y1 * scaleY;
      const w = (det.x2 - det.x1) * scaleX;
      const h = (det.y2 - det.y1) * scaleY;

      // Draw box
      ctx.strokeStyle = '#00ff08';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      // Corner brackets (tactical look)
      const bracketLen = 15;
      ctx.beginPath();
      // Top left
      ctx.moveTo(x, y + bracketLen); ctx.lineTo(x, y); ctx.lineTo(x + bracketLen, y);
      // Top right
      ctx.moveTo(x + w - bracketLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + bracketLen);
      // Bottom right
      ctx.moveTo(x + w, y + h - bracketLen); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - bracketLen, y + h);
      // Bottom left
      ctx.moveTo(x + bracketLen, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - bracketLen);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      const labelText = `${det.label.toUpperCase()} ${Math.round(det.confidence * 100)}%`;
      ctx.font = "bold 14px 'Space Mono', monospace";
      const textMetrics = ctx.measureText(labelText);
      const textWidth = textMetrics.width;
      
      ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
      ctx.fillRect(x, y - 24, textWidth + 10, 24);
      
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, x + 5, y - 7);
    });

    setThreatDetected(localThreat);
  }, []);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || videoRef.current.videoWidth === 0) return null;
    const offscreen = document.createElement('canvas');
    offscreen.width = videoRef.current.videoWidth;
    offscreen.height = videoRef.current.videoHeight;
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
      return offscreen.toDataURL('image/jpeg', 0.7);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!cameraActive) return;

    let isActive = true;

    const processFrame = async () => {
      if (!isActive) return;

      const now = Date.now();
      const currentFps = Math.round(1000 / (now - lastTimeRef.current));
      lastTimeRef.current = now;
      setFps(currentFps);

      const frameBase64 = captureFrame();
      if (frameBase64) {
        try {
          const res = await fetch('http://192.168.0.177:8000/ai/detect', {
          // const res = await fetch('http://10.10.8.112:8000/ai/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: frameBase64 })
          });
          if (res.ok) {
            const data = await res.json();
            const detections: Detection[] = data.detections || [];
            
            setDetectionCount(detections.length);
            drawDetections(detections);

            if (detections.length > 0) {
              setLogs(prev => {
                const newLogs = [...detections.map(d => ({
                  id: Math.random().toString(36).substring(7),
                  timestamp: new Date(),
                  label: d.label,
                  confidence: d.confidence
                })), ...prev];
                return newLogs.slice(0, 10);
              });
            }
          }
        } catch (e) {
          // Ignore fetch errors to keep loop running smoothly
        }
      }

      setTimeout(processFrame, 200);
    };

    processFrame();

    return () => { isActive = false; };
  }, [cameraActive, captureFrame, drawDetections]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-mono dark">
      {/* HEADER */}
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-3">
          <Crosshair className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-widest text-primary leading-none">Gun Detection System Using Deep Learning</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Real-time Gun Detection</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-muted-foreground" />
            <span className={cameraActive ? "text-green-500" : "text-muted-foreground"}>
              {cameraActive ? "CAM ONLINE" : "CAM OFFLINE"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-muted-foreground" />
            <span className={modelReady ? "text-green-500" : "text-red-500"}>
              {modelReady ? "MODEL READY" : "MODEL OFFLINE"}
            </span>
          </div>
          <div className="flex items-center gap-2 border-l border-border pl-6">
            <Activity className="w-4 h-4 text-primary" />
            <span className="font-bold w-16">{fps} FPS</span>
          </div>
        </div>
      </header>

      {/* ALERT BANNER */}
      {threatDetected && (
        <div className="bg-destructive text-destructive-foreground px-4 py-2 font-bold text-center tracking-widest animate-pulse border-b-4 border-red-900 z-20 shadow-[0_0_20px_rgba(255,0,0,0.5)]">
          <div className="flex items-center justify-center gap-2">
            <AlertCircle className="w-5 h-5" />
            THREAT DETECTED
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 flex overflow-hidden">
        {/* VIDEO FEED */}
        <div className="flex-1 relative bg-black flex items-center justify-center p-4">
          
          <div ref={wrapperRef} className="relative max-w-full max-h-full border border-border shadow-2xl bg-zinc-950">
            {/* Grid overlay for tactical feel */}
            <div className="absolute inset-0 pointer-events-none z-10" style={{
              backgroundImage: 'linear-gradient(rgba(0, 255, 0, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 0, 0.05) 1px, transparent 1px)',
              backgroundSize: '40px 40px'
            }} />
            
            {/* Corner markers on the video frame */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-primary/50 pointer-events-none z-10" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-primary/50 pointer-events-none z-10" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-primary/50 pointer-events-none z-10" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-primary/50 pointer-events-none z-10" />
            
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="max-w-full max-h-[calc(100vh-140px)] object-contain block filter contrast-[1.1] saturate-[1.1] grayscale-[0.2]"
            />
            <canvas 
              ref={canvasRef} 
              className="absolute top-0 left-0 w-full h-full pointer-events-none z-20"
            />

            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground z-30 bg-black/80">
                <MonitorPlay className="w-16 h-16 mb-4 opacity-50" />
                <p className="tracking-widest animate-pulse">INITIALIZING VIDEO FEED...</p>
              </div>
            )}
          </div>
          
          {/* Target reticle overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10 opacity-20">
             <Crosshair className="w-[800px] h-[800px] text-white stroke-[0.5]" />
          </div>
        </div>

        {/* SIDEBAR LOGS */}
        <aside className="w-80 border-l border-border bg-card flex flex-col z-10 relative">
          <div className="px-4 py-3 border-b border-border bg-black/40 flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-bold tracking-widest text-muted-foreground">DETECTION LOG</h2>
            <div className="ml-auto bg-primary/20 text-primary px-2 py-0.5 text-xs rounded border border-primary/30">
              {detectionCount} ACTIVE
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {logs.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-10 opacity-50">
                NO DETECTIONS IN LOG
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="border border-border bg-black/40 p-3 relative group hover:border-primary/50 transition-colors">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80" />
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-primary tracking-wider">{log.label.toUpperCase()}</span>
                    <span className="text-xs text-muted-foreground">
                      {log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second:'2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-border rounded overflow-hidden">
                      <div 
                        className="h-full bg-primary" 
                        style={{ width: `${log.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-foreground">
                      {Math.round(log.confidence * 100)}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
