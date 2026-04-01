import { useEffect, useRef, useState, useCallback } from "react";

const LEADERBOARD_CSV_URL =
  "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/pub?gid=LEADERBOARD_TAB_ID&single=true&output=csv";
const PIPELINE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/pub?gid=PIPELINE_TAB_ID&single=true&output=csv";

const REFRESH_INTERVAL = 30000;

interface LeaderboardRow {
  name: string;
  meetings: number;
  gifUrl: string;
}

interface PipelineRow {
  label: string;
  value: number;
}

function parseCSV(text: string): string[][] {
  const lines = text.trim().split("\n");
  return lines.map((line) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function extractDriveId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const idMatch = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return null;
}

function getDirectGifUrl(url: string): string {
  if (!url) return "";
  if (url.includes("drive.google.com")) {
    const id = extractDriveId(url);
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }
  return url;
}

const BAR_COLORS = [
  "#FF6B35",
  "#1E90FF",
  "#0A1F44",
  "#FF8C42",
  "#3AA0FF",
  "#F24236",
  "#2EC4B6",
  "#E9C46A",
  "#264653",
  "#A8DADC",
];

function PipelineChart({ data }: { data: PipelineRow[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<unknown>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const labels = data.map((d) => d.label);
    const values = data.map((d) => d.value);
    const colors = data.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]);

    if (chartRef.current) {
      const chart = chartRef.current as {
        data: { labels: string[]; datasets: { data: number[]; backgroundColor: string[] }[] };
        update: () => void;
      };
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].backgroundColor = colors;
      chart.update();
      return;
    }

    const win = window as Window & { Chart?: new (...args: unknown[]) => unknown };
    if (!win.Chart) return;

    const ChartConstructor = win.Chart as new (
      ctx: CanvasRenderingContext2D,
      config: object
    ) => unknown;

    chartRef.current = new ChartConstructor(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Pipeline",
            data: values,
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: { parsed: { y: number } }) =>
                ` ${ctx.parsed.y.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: "#6B7280",
              font: { family: "Inter", size: 12 },
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.05)" },
            ticks: {
              color: "#6B7280",
              font: { family: "Inter", size: 12 },
            },
          },
        },
      },
    });
  }, [data]);

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} />
    </div>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 20 }, (_, i) => i);
  const colors = ["#FF6B35", "#1E90FF", "#FFD700", "#0A1F44", "#FF8C42"];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-sm opacity-0"
          style={{
            left: `${Math.random() * 100}%`,
            top: "-8px",
            backgroundColor: colors[i % colors.length],
            animation: `confettiFall ${1.5 + Math.random() * 2}s ease-in ${Math.random() * 0.8}s forwards`,
            transform: `rotate(${Math.random() * 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function CrownIcon() {
  return (
    <span
      className="mr-1 text-base"
      style={{ filter: "drop-shadow(0 1px 2px rgba(255,165,0,0.6))" }}
    >
      👑
    </span>
  );
}

export default function Dashboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [leaderboardUpdated, setLeaderboardUpdated] = useState<Date | null>(null);
  const [pipelineUpdated, setPipelineUpdated] = useState<Date | null>(null);
  const [prevTop, setPrevTop] = useState<string | null>(null);
  const [topChanged, setTopChanged] = useState(false);
  const [gifFadeIn, setGifFadeIn] = useState(false);
  const [chartJsLoaded, setChartJsLoaded] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(LEADERBOARD_CSV_URL);
      const text = await res.text();
      const rows = parseCSV(text);
      if (rows.length < 2) return;
      const data: LeaderboardRow[] = rows
        .slice(1)
        .map((row) => ({
          name: row[0] || "",
          meetings: parseInt(row[1] || "0", 10) || 0,
          gifUrl: row[2] || "",
        }))
        .filter((r) => r.name)
        .sort((a, b) => b.meetings - a.meetings);

      setLeaderboard((prev) => {
        const newTop = data[0]?.name || null;
        const oldTop = prev[0]?.name || null;
        if (newTop && newTop !== oldTop) {
          setPrevTop(oldTop);
          setTopChanged(true);
          setGifFadeIn(false);
          setTimeout(() => setGifFadeIn(true), 50);
        }
        return data;
      });
      setLeaderboardUpdated(new Date());
    } catch (_e) {
    }
  }, []);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch(PIPELINE_CSV_URL);
      const text = await res.text();
      const rows = parseCSV(text);
      if (rows.length < 2) return;
      const data: PipelineRow[] = rows
        .slice(1)
        .map((row) => ({
          label: row[0] || "",
          value: parseFloat(row[1] || "0") || 0,
        }))
        .filter((r) => r.label);
      setPipeline(data);
      setPipelineUpdated(new Date());
    } catch (_e) {
    }
  }, []);

  useEffect(() => {
    const loadChartJs = () => {
      const win = window as Window & { Chart?: unknown };
      if (win.Chart) {
        setChartJsLoaded(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      script.onload = () => setChartJsLoaded(true);
      document.head.appendChild(script);
    };
    loadChartJs();
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    fetchPipeline();
    const interval = setInterval(() => {
      fetchLeaderboard();
      fetchPipeline();
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLeaderboard, fetchPipeline]);

  useEffect(() => {
    if (topChanged) {
      const t = setTimeout(() => setTopChanged(false), 500);
      return () => clearTimeout(t);
    }
  }, [topChanged]);

  const top1 = leaderboard[0] || null;
  const top1GifUrl = top1 ? getDirectGifUrl(top1.gifUrl) : "";

  const formatTime = (d: Date | null) => {
    if (!d) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div
      className="flex flex-col"
      style={{
        height: "100vh",
        background: "#F5F7FA",
        fontFamily: "'Inter', sans-serif",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(300px) rotate(720deg); opacity: 0; }
        }

        @keyframes fadeInRow {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes fadeInGif {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }

        .leaderboard-row {
          animation: fadeInRow 0.35s ease both;
        }

        .gif-container {
          animation: fadeInGif 0.5s ease both;
        }

        .rank-gold {
          background: linear-gradient(90deg, #FFF8E1 0%, #FFF3CD 100%);
        }

        .panel-card {
          background: #FFFFFF;
          border-radius: 10px;
          box-shadow: 0 2px 12px rgba(10,31,68,0.08);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .panel-header {
          border-top: 3px solid #FF6B35;
          padding: 14px 20px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #F0F0F0;
        }

        .live-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(255,107,53,0.12);
          color: #FF6B35;
          border: 1px solid rgba(255,107,53,0.3);
          border-radius: 20px;
          padding: 3px 12px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.05em;
        }

        .live-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #FF6B35;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }

        @media (max-width: 768px) {
          .dashboard-split {
            flex-direction: column !important;
            height: auto !important;
            overflow-y: auto !important;
          }
          .left-panel, .right-panel {
            width: 100% !important;
            height: 50vh !important;
            min-height: 400px;
          }
        }
      `}</style>

      <nav
        style={{
          background: "#0A1F44",
          color: "#FFFFFF",
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          borderBottom: "3px solid #FF6B35",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              background: "#FF6B35",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
              color: "#fff",
            }}
          >
            GC
          </div>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>
            GoComet Dashboard
          </span>
        </div>
        <div className="live-badge">
          <span className="live-dot" />
          LIVE
        </div>
      </nav>

      <div
        className="dashboard-split"
        style={{
          display: "flex",
          flex: 1,
          gap: 16,
          padding: 16,
          overflow: "hidden",
        }}
      >
        <div
          className="left-panel panel-card"
          style={{ width: "60%", flex: "0 0 60%" }}
        >
          <div className="panel-header">
            <span style={{ fontWeight: 700, fontSize: 15, color: "#0A1F44" }}>
              Meetings Leaderboard
            </span>
            <span style={{ color: "#6B7280", fontSize: 12 }}>
              Last updated: {formatTime(leaderboardUpdated)}
            </span>
          </div>

          {top1 && (
            <div
              className="gif-container"
              key={top1.name}
              style={{
                position: "relative",
                background: "linear-gradient(135deg, #0A1F44 0%, #1a3a6e 100%)",
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 16,
                opacity: gifFadeIn ? 1 : 0,
                transition: "opacity 0.5s ease",
                minHeight: 100,
                flexShrink: 0,
              }}
            >
              {topChanged && <Confetti />}

              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "3px solid #FF6B35",
                  flexShrink: 0,
                  background: "#0A1F44",
                }}
              >
                {top1GifUrl ? (
                  <img
                    src={top1GifUrl}
                    alt={top1.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "linear-gradient(135deg, #FF6B35, #FF8C42)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 28,
                    }}
                  >
                    🎉
                  </div>
                )}
              </div>

              <div>
                <div
                  style={{
                    color: "#FF6B35",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 4,
                  }}
                >
                  👑 #1 This Week
                </div>
                <div
                  style={{
                    color: "#FFFFFF",
                    fontSize: 20,
                    fontWeight: 700,
                    lineHeight: 1.2,
                  }}
                >
                  {top1.name}
                </div>
                <div
                  style={{
                    color: "#FF6B35",
                    fontSize: 15,
                    fontWeight: 600,
                    marginTop: 4,
                  }}
                >
                  {top1.meetings} meetings
                </div>
              </div>
            </div>
          )}

          {leaderboard.length === 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#6B7280",
                fontSize: 14,
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 32 }}>📋</div>
              <div>
                Update <code style={{ fontSize: 12, color: "#1E90FF" }}>LEADERBOARD_CSV_URL</code> to load data
              </div>
            </div>
          )}

          {leaderboard.length > 0 && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      background: "#F9FAFB",
                      borderBottom: "1px solid #E5E7EB",
                    }}
                  >
                    <th
                      style={{
                        padding: "10px 20px",
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#6B7280",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        width: 60,
                      }}
                    >
                      Rank
                    </th>
                    <th
                      style={{
                        padding: "10px 20px",
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#6B7280",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      Name
                    </th>
                    <th
                      style={{
                        padding: "10px 20px",
                        textAlign: "right",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#6B7280",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        width: 120,
                      }}
                    >
                      Meetings
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => (
                    <tr
                      key={row.name}
                      className={`leaderboard-row ${i === 0 ? "rank-gold" : ""}`}
                      style={{
                        borderBottom: "1px solid #F3F4F6",
                        animationDelay: `${i * 0.04}s`,
                      }}
                    >
                      <td
                        style={{
                          padding: "12px 20px",
                          fontSize: 14,
                          fontWeight: 700,
                          color: i === 0 ? "#D97706" : "#6B7280",
                        }}
                      >
                        {i === 0 ? (
                          <span style={{ display: "flex", alignItems: "center" }}>
                            <CrownIcon />
                            {i + 1}
                          </span>
                        ) : (
                          `#${i + 1}`
                        )}
                      </td>
                      <td
                        style={{
                          padding: "12px 20px",
                          fontSize: 14,
                          fontWeight: i === 0 ? 700 : 500,
                          color: i === 0 ? "#1A1A2E" : "#374151",
                        }}
                      >
                        {row.name}
                      </td>
                      <td
                        style={{
                          padding: "12px 20px",
                          textAlign: "right",
                          fontSize: 14,
                          fontWeight: 700,
                          color: i === 0 ? "#FF6B35" : "#0A1F44",
                        }}
                      >
                        {row.meetings.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              padding: "8px 20px",
              borderTop: "1px solid #F0F0F0",
              color: "#9CA3AF",
              fontSize: 11,
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            Auto-refreshes every 30s
          </div>
        </div>

        <div
          className="right-panel panel-card"
          style={{ flex: 1 }}
        >
          <div className="panel-header">
            <span style={{ fontWeight: 700, fontSize: 15, color: "#0A1F44" }}>
              Pipeline Overview
            </span>
            <span style={{ color: "#6B7280", fontSize: 12 }}>
              Last updated: {formatTime(pipelineUpdated)}
            </span>
          </div>

          <div style={{ flex: 1, padding: 20, minHeight: 0 }}>
            {pipeline.length === 0 ? (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#6B7280",
                  fontSize: 14,
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 32 }}>📊</div>
                <div>
                  Update <code style={{ fontSize: 12, color: "#1E90FF" }}>PIPELINE_CSV_URL</code> to load data
                </div>
              </div>
            ) : chartJsLoaded ? (
              <PipelineChart data={pipeline} />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#6B7280",
                  fontSize: 14,
                }}
              >
                Loading chart...
              </div>
            )}
          </div>

          <div
            style={{
              padding: "8px 20px",
              borderTop: "1px solid #F0F0F0",
              color: "#9CA3AF",
              fontSize: 11,
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            Auto-refreshes every 30s
          </div>
        </div>
      </div>
    </div>
  );
}
