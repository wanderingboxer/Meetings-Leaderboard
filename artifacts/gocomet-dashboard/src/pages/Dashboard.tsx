import { useEffect, useRef, useState, useCallback } from "react";

const LEADERBOARD_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTaQ3nxjerGzxpDVYGgyr3VJq6iqMTvP1Ox0tAHCCryLxMFNG-m_AU2r3zZD_Zxvp-qXwzXBV7RugTS/pub?gid=1575208426&single=true&output=csv";
const PIPELINE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTaQ3nxjerGzxpDVYGgyr3VJq6iqMTvP1Ox0tAHCCryLxMFNG-m_AU2r3zZD_Zxvp-qXwzXBV7RugTS/pub?gid=0&single=true&output=csv";

const REFRESH_INTERVAL = 30000;

const TV_W = 1920;
const TV_H = 1080;

interface LeaderboardRow {
  name: string;
  meetings: number;
  gifUrl: string;
}

interface PipelineRow {
  label: string;
  value: number;
}

// ── Insight history ──────────────────────────────────────────────────────────
interface LeaderboardSnapshot {
  ts: number;
  ranks: Record<string, number>; // { "Surya": 14, "Jana": 9, ... }
}
interface InsightHistory {
  sessionStart: LeaderboardSnapshot | null;
  dayStart:     LeaderboardSnapshot | null;
  weekStart:    LeaderboardSnapshot | null;
  snapshots:    LeaderboardSnapshot[]; // in-memory ring buffer, max 96 entries
}
const HISTORY_KEY     = "gc_insight_history";
const HISTORY_VERSION = 1;
const MAX_MEM_SNAPS   = 96;
const MAX_STORE_SNAPS = 12;

function todayMidnight(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}
function thisMonday(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.getTime();
}
function loadHistory(): InsightHistory {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) throw new Error();
    const p = JSON.parse(raw);
    if (p.version !== HISTORY_VERSION) throw new Error();
    const tm = todayMidnight(), mm = thisMonday();
    return {
      sessionStart: p.sessionStart ?? null,
      dayStart:  p.dayStart  && p.dayStart.ts  >= tm ? p.dayStart  : null,
      weekStart: p.weekStart && p.weekStart.ts >= mm ? p.weekStart : null,
      snapshots: Array.isArray(p.snapshots) ? p.snapshots : [],
    };
  } catch { return { sessionStart: null, dayStart: null, weekStart: null, snapshots: [] }; }
}
function saveHistory(h: InsightHistory): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({
      version: HISTORY_VERSION,
      sessionStart: h.sessionStart,
      dayStart:     h.dayStart,
      weekStart:    h.weekStart,
      snapshots:    h.snapshots.slice(-MAX_STORE_SNAPS),
    }));
  } catch { /* quota – silently skip */ }
}
function recordSnapshot(data: LeaderboardRow[], h: InsightHistory): InsightHistory {
  const snap: LeaderboardSnapshot = {
    ts: Date.now(),
    ranks: Object.fromEntries(data.map(r => [r.name, r.meetings])),
  };
  const snaps = [...h.snapshots, snap];
  if (snaps.length > MAX_MEM_SNAPS) snaps.shift();
  const tm = todayMidnight(), mm = thisMonday();
  return {
    sessionStart: h.sessionStart ?? snap,
    dayStart:  (!h.dayStart  || h.dayStart.ts  < tm) ? snap : h.dayStart,
    weekStart: (!h.weekStart || h.weekStart.ts < mm) ? snap : h.weekStart,
    snapshots: snaps,
  };
}

// ── Insight generators ───────────────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function insightLeaderStreak(cur: LeaderboardRow[], h: InsightHistory): string | null {
  if (!cur[0] || !h.weekStart) return null;
  const leader = cur[0];
  const weekTop = Object.entries(h.weekStart.ranks).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (weekTop !== leader.name) return null;
  return pick([
    `${leader.name} has held the #1 spot all week — ${leader.meetings} meetings and counting! 💪`,
    `Nobody can stop ${leader.name} — leading since Monday with ${leader.meetings} meetings.`,
    `${leader.name} set the pace on Monday and hasn't looked back. ${leader.meetings} meetings strong.`,
  ]);
}

function insightMomentumUp(cur: LeaderboardRow[], h: InsightHistory): string | null {
  if (cur.length < 2 || h.snapshots.length < 4) return null;
  const recent = h.snapshots[Math.max(0, h.snapshots.length - 4)];
  let bestGain = 0, bestName = "", bestMeetings = 0;
  for (const row of cur.slice(1)) {
    const gain = row.meetings - (recent.ranks[row.name] ?? row.meetings);
    if (gain > bestGain) { bestGain = gain; bestName = row.name; bestMeetings = row.meetings; }
  }
  if (bestGain < 1) return null;
  const s = bestGain === 1 ? "" : "s";
  return pick([
    `🔥 ${bestName} is on a roll — ${bestGain} new meeting${s} booked in the last few minutes!`,
    `Watch out for ${bestName} — up ${bestGain} meeting${s} and climbing fast! 📈`,
    `${bestName} is surging! ${bestGain} meeting${s} added recently — now at ${bestMeetings}.`,
  ]);
}

function insightMomentumDown(cur: LeaderboardRow[], h: InsightHistory): string | null {
  if (cur.length < 4 || !h.dayStart) return null;
  const curRank: Record<string, number> = {};
  cur.forEach((r, i) => { curRank[r.name] = i + 1; });
  const dayTop = Object.entries(h.dayStart.ranks).sort((a, b) => b[1] - a[1]);
  let worstName = "", worstDay = 0, worstNow = 0, worstDrop = 0;
  for (let i = 0; i < Math.min(3, dayTop.length); i++) {
    const [name] = dayTop[i];
    const drop = (curRank[name] ?? 999) - (i + 1);
    if (drop >= 2 && drop > worstDrop) {
      worstDrop = drop; worstName = name; worstDay = i + 1; worstNow = curRank[name] ?? 999;
    }
  }
  if (!worstName) return null;
  return pick([
    `${worstName} started the day at #${worstDay} but has slipped to #${worstNow}. Time to push! ⚡`,
    `${worstName} has gone quiet after a strong start — was #${worstDay} this morning, now #${worstNow}.`,
    `Can ${worstName} bounce back? Dropped from #${worstDay} to #${worstNow} today. 👀`,
  ]);
}

function insightProximity(cur: LeaderboardRow[]): string | null {
  if (cur.length < 3) return null;
  const gap = cur[1].meetings - cur[2].meetings;
  if (gap === 0) return pick([
    `🤝 ${cur[1].name} and ${cur[2].name} are completely tied — every single meeting counts!`,
    `Dead heat between ${cur[1].name} and ${cur[2].name} — equal meetings right now!`,
  ]);
  if (gap > 3) return null;
  const s = gap === 1 ? "" : "s";
  return pick([
    `Only ${gap} meeting${s} separate #2 ${cur[1].name} and #3 ${cur[2].name} — the race is on! 🏁`,
    `${cur[1].name} and ${cur[2].name} are neck-and-neck — just ${gap} meeting${s} apart. 🔥`,
    `Battle for #2: ${cur[2].name} is just ${gap} meeting${s} behind ${cur[1].name}. Can they overtake?`,
  ]);
}

function insightComeback(cur: LeaderboardRow[], h: InsightHistory): string | null {
  if (cur.length < 3 || !h.dayStart || !h.sessionStart) return null;
  const curRank: Record<string, number> = {};
  cur.forEach((r, i) => { curRank[r.name] = i + 1; });
  const dayRank: Record<string, number> = {};
  Object.entries(h.dayStart.ranks).sort((a, b) => b[1] - a[1]).forEach(([n], i) => { dayRank[n] = i + 1; });
  const sessRank: Record<string, number> = {};
  Object.entries(h.sessionStart.ranks).sort((a, b) => b[1] - a[1]).forEach(([n], i) => { sessRank[n] = i + 1; });
  for (const row of cur) {
    const sr = sessRank[row.name], dr = dayRank[row.name], cr = curRank[row.name];
    if (!sr || !dr) continue;
    if (dr > sr + 1 && cr < dr - 1) {
      const gained = dr - cr;
      const s = gained === 1 ? "" : "s";
      return pick([
        `💪 ${row.name} is making a comeback — up ${gained} spot${s} since earlier today!`,
        `${row.name} looked down-and-out this morning but is rallying back up the board! 📈`,
        `Don't count out ${row.name} — they've clawed back ${gained} position${s} today.`,
      ]);
    }
  }
  return null;
}

function insightSessionGain(cur: LeaderboardRow[], h: InsightHistory): string | null {
  if (!h.sessionStart || h.snapshots.length < 2) return null;
  if (Date.now() - h.sessionStart.ts < 120000) return null;
  let bestGain = 0, bestName = "", bestNow = 0;
  for (const row of cur) {
    const gain = row.meetings - (h.sessionStart.ranks[row.name] ?? 0);
    if (gain > bestGain) { bestGain = gain; bestName = row.name; bestNow = row.meetings; }
  }
  if (bestGain < 1) return null;
  const s = bestGain === 1 ? "" : "s";
  return pick([
    `📊 ${bestName} has booked ${bestGain} meeting${s} since this session started — now at ${bestNow}.`,
    `${bestName} leads the session with ${bestGain} new meeting${s} added. Keep it up!`,
    `Top performer this session: ${bestName} with ${bestGain} new meeting${s}! 🎯`,
  ]);
}

function insightWeekClimber(cur: LeaderboardRow[], h: InsightHistory): string | null {
  if (cur.length < 3 || !h.weekStart) return null;
  const curRank: Record<string, number> = {};
  cur.forEach((r, i) => { curRank[r.name] = i + 1; });
  const weekTop = Object.entries(h.weekStart.ranks).sort((a, b) => b[1] - a[1]);
  let bestName = "", bestClimb = 0, bestFrom = 0, bestTo = 0;
  weekTop.forEach(([name], i) => {
    const climb = (i + 1) - (curRank[name] ?? 999);
    if (climb >= 2 && climb > bestClimb) {
      bestClimb = climb; bestName = name; bestFrom = i + 1; bestTo = curRank[name] ?? 999;
    }
  });
  if (!bestName) return null;
  const s = bestClimb === 1 ? "" : "s";
  return pick([
    `📈 ${bestName} has climbed ${bestClimb} spot${s} since Monday — from #${bestFrom} to #${bestTo}!`,
    `${bestName} is gaining momentum — up ${bestClimb} place${s} since the start of the week.`,
    `Best week-on-week climber: ${bestName}, up ${bestClimb} spot${s} since Monday! 🚀`,
  ]);
}

function insightFallback(cur: LeaderboardRow[]): string {
  if (cur.length === 0) return "Loading leaderboard data...";
  if (cur.length === 1) return `${cur[0].name} is leading with ${cur[0].meetings} meetings.`;
  const chasing = cur.slice(1, 4).map(r => `${r.name} (${r.meetings})`).join(", ");
  return pick([
    `${cur[0].name} leads with ${cur[0].meetings} meetings. Chasing: ${chasing}.`,
    `📊 Current standings: ${cur[0].name} on top with ${cur[0].meetings} meetings.`,
    `🏆 ${cur[0].name} is out front with ${cur[0].meetings} meetings — who can catch them?`,
  ]);
}

function generateInsights(cur: LeaderboardRow[], h: InsightHistory): string[] {
  const add = (text: string | null, pri: number) => text ? [{ text, pri }] : [];
  return [
    ...add(insightMomentumUp(cur, h),    90),
    ...add(insightLeaderStreak(cur, h),  80),
    ...add(insightProximity(cur),        75),
    ...add(insightComeback(cur, h),      70),
    ...add(insightWeekClimber(cur, h),   65),
    ...add(insightMomentumDown(cur, h),  60),
    ...add(insightSessionGain(cur, h),   55),
    ...add(insightFallback(cur),         10),
  ].sort((a, b) => b.pri - a.pri).map(r => r.text);
}

// ── InsightTicker component ──────────────────────────────────────────────────
function InsightTicker({ insights }: { insights: string[] }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setIdx(0); setVisible(true);
  }, [insights]);

  useEffect(() => {
    if (insights.length <= 1) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIdx(p => (p + 1) % insights.length); setVisible(true); }, 400);
    }, 8000);
    return () => clearInterval(t);
  }, [insights.length]);

  if (insights.length === 0) return null;
  const text = insights[idx % insights.length];

  return (
    <div style={{
      flexShrink: 0, height: 90,
      background: "linear-gradient(135deg, #0A1F44 0%, #0f2d5e 100%)",
      display: "flex", alignItems: "center", gap: 16, padding: "0 28px",
      borderTop: "1px solid rgba(255,107,53,0.25)",
    }}>
      <div style={{ width: 4, height: 52, background: "#FF6B35", borderRadius: 2, flexShrink: 0 }} />
      <div style={{ fontSize: 22, flexShrink: 0 }}>💡</div>
      <div style={{
        flex: 1, color: "#fff", fontSize: 18, fontWeight: 500, lineHeight: 1.45,
        opacity: visible ? 1 : 0, transition: "opacity 0.4s ease",
      }}>
        {text}
      </div>
      {insights.length > 1 && (
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          {insights.map((_, i) => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: "50%",
              background: i === idx % insights.length ? "#FF6B35" : "rgba(255,255,255,0.25)",
              transition: "background 0.3s ease",
            }} />
          ))}
        </div>
      )}
    </div>
  );
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
    if (id) return `https://lh3.googleusercontent.com/d/${id}`;
  }
  return url;
}

function getDriveFallbackUrl(src: string): string {
  if (src.includes("lh3.googleusercontent.com/d/")) {
    const id = src.split("/d/")[1];
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }
  return "";
}

function handleGifError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const fallback = getDriveFallbackUrl(img.src);
  if (fallback) img.src = fallback;
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

type ChartInstance = {
  data: {
    labels: string[];
    datasets: { data: number[]; backgroundColor: string[] }[];
  };
  update: () => void;
  destroy: () => void;
};

function PipelineChart({ data }: { data: PipelineRow[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    const win = window as Window & {
      Chart?: new (ctx: CanvasRenderingContext2D, config: object) => ChartInstance;
      ChartDataLabels?: unknown;
    };
    if (!canvasRef.current || data.length === 0 || !win.Chart) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const labels = data.map((d) => d.label);
    const values = data.map((d) => d.value);
    const colors = data.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]);

    if (chartRef.current) {
      chartRef.current.data.labels = labels;
      chartRef.current.data.datasets[0].data = values;
      chartRef.current.data.datasets[0].backgroundColor = colors;
      chartRef.current.update();
      return;
    }

    const plugins: unknown[] = [];
    if (win.ChartDataLabels) plugins.push(win.ChartDataLabels);

    chartRef.current = new win.Chart(ctx, {
      type: "bar",
      plugins,
      data: {
        labels,
        datasets: [
          {
            label: "Pipeline",
            data: values,
            backgroundColor: colors,
            borderRadius: 8,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 36 },
        },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          datalabels: {
            anchor: "end",
            align: "top",
            color: "#1A1A2E",
            font: {
              family: "Inter",
              size: 16,
              weight: "700",
            },
            formatter: (value: number) => value.toLocaleString(),
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: "#6B7280",
              font: { family: "Inter", size: 15 },
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.05)" },
            ticks: {
              color: "#6B7280",
              font: { family: "Inter", size: 14 },
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 24 }, (_, i) => i);
  const colors = ["#FF6B35", "#1E90FF", "#FFD700", "#0A1F44", "#FF8C42"];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {pieces.map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 10,
            height: 10,
            borderRadius: 2,
            opacity: 0,
            left: `${Math.random() * 100}%`,
            top: "-12px",
            backgroundColor: colors[i % colors.length],
            animation: `confettiFall ${1.5 + Math.random() * 2}s ease-in ${Math.random() * 0.8}s forwards`,
            transform: `rotate(${Math.random() * 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}

interface TvLayout { scale: number; left: number; top: number; }

function useTvScale(): TvLayout {
  const [layout, setLayout] = useState<TvLayout>({ scale: 1, left: 0, top: 0 });

  useEffect(() => {
    const compute = () => {
      const scaleX = window.innerWidth / TV_W;
      const scaleY = window.innerHeight / TV_H;
      const scale = Math.min(scaleX, scaleY);
      const left = (window.innerWidth - TV_W * scale) / 2;
      const top = (window.innerHeight - TV_H * scale) / 2;
      setLayout({ scale, left, top });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  return layout;
}

export default function Dashboard() {
  const { scale, left, top } = useTvScale();

  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [leaderboardUpdated, setLeaderboardUpdated] = useState<Date | null>(null);
  const [pipelineUpdated, setPipelineUpdated] = useState<Date | null>(null);
  const [topChanged, setTopChanged] = useState(false);
  const [gifFadeIn, setGifFadeIn] = useState(false);
  const [fullScreenGif, setFullScreenGif] = useState<string | null>(null);
  const [fullScreenGifFade, setFullScreenGifFade] = useState(false);
  const [chartJsLoaded, setChartJsLoaded] = useState(false);
  const [insights, setInsights] = useState<string[]>([]);
  const historyRef = useRef<InsightHistory>(loadHistory());

  const fetchLeaderboard = useCallback(async () => {
    try {
      const nocacheUrl = `${LEADERBOARD_CSV_URL}&t=${Date.now()}`;
      const res = await fetch(nocacheUrl, { cache: "no-store" });
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
        const newTop = data[0];
        const oldTop = prev[0];
        if (newTop && (!oldTop || newTop.name !== oldTop.name)) {
          setTopChanged(true);
          setGifFadeIn(false);
          setFullScreenGifFade(false);
          const gifUrl = getDirectGifUrl(newTop.gifUrl);
          if (gifUrl) {
            setFullScreenGif(gifUrl);
            setTimeout(() => setFullScreenGifFade(true), 100);
          }
          setTimeout(() => setGifFadeIn(true), 100);
        }
        return data;
      });
      const updated = recordSnapshot(data, historyRef.current);
      historyRef.current = updated;
      saveHistory(updated);
      setInsights(generateInsights(data, updated));
      setLeaderboardUpdated(new Date());
    } catch (_e) {}
  }, []);

  const fetchPipeline = useCallback(async () => {
    try {
      const nocacheUrl = `${PIPELINE_CSV_URL}&t=${Date.now()}`;
      const res = await fetch(nocacheUrl, { cache: "no-store" });
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
    } catch (_e) {}
  }, []);

  useEffect(() => {
    const loadScripts = async () => {
      const win = window as Window & { Chart?: unknown; ChartDataLabels?: unknown };

      await new Promise<void>((resolve) => {
        if (win.Chart) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chart.js";
        s.onload = () => resolve();
        document.head.appendChild(s);
      });

      await new Promise<void>((resolve) => {
        if (win.ChartDataLabels) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2";
        s.onload = () => resolve();
        document.head.appendChild(s);
      });

      setChartJsLoaded(true);
    };

    loadScripts();
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
    if (!topChanged) return;
    const t = setTimeout(() => setTopChanged(false), 2500);
    return () => clearTimeout(t);
  }, [topChanged]);

  useEffect(() => {
    if (!fullScreenGif || !fullScreenGifFade) return;
    const t = setTimeout(() => {
      setFullScreenGifFade(false);
      setTimeout(() => setFullScreenGif(null), 500);
    }, 4500);
    return () => clearTimeout(t);
  }, [fullScreenGif, fullScreenGifFade]);

  const top1 = leaderboard[0] || null;
  const top1GifUrl = top1 ? getDirectGifUrl(top1.gifUrl) : "";

  const formatTime = (d: Date | null) =>
    d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const NAV_H = 64;
  const PADDING = 18;
  const CONTENT_H = TV_H - NAV_H - PADDING * 2;
  const LEFT_W = TV_W * 0.68 - PADDING * 1.5;

  const TOP1_BANNER_H = top1 ? 192 : 0;
  const PANEL_HEADER_H = 60;
  const PANEL_FOOTER_H = 36;
  const INSIGHTS_H = 90;
  const TABLE_H = CONTENT_H - TOP1_BANNER_H - PANEL_HEADER_H - PANEL_FOOTER_H - INSIGHTS_H;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        html, body, #root {
          width: 100%;
          height: 100%;
          background: #0A1F44;
          overflow: hidden;
          font-family: 'Inter', sans-serif;
        }

        @keyframes confettiFall {
          0%   { transform: translateY(0)     rotate(0deg);   opacity: 1; }
          100% { transform: translateY(400px) rotate(720deg); opacity: 0; }
        }
        @keyframes fadeInRow {
          from { opacity: 0; transform: translateX(-14px); }
          to   { opacity: 1; transform: translateX(0);     }
        }
        @keyframes fadeInGif {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1);    }
        }
        @keyframes livePulse {
          0%,100% { opacity: 1; transform: scale(1);   }
          50%     { opacity: 0.45; transform: scale(1.4); }
        }

        .lb-row { animation: fadeInRow 0.35s ease both; }
        .gold-row { background: linear-gradient(90deg, #FFF8E1, #FFF3CD); }
      `}</style>

      {/* Full-screen GIF overlay when leader changes */}
      {fullScreenGif && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            opacity: fullScreenGifFade ? 1 : 0,
            transition: "opacity 0.5s ease",
            pointerEvents: fullScreenGifFade ? "auto" : "none",
          }}
        >
          <img
            src={fullScreenGif}
            alt="Leader celebration"
            onError={handleGifError}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              maxWidth: "100vw",
              maxHeight: "100vh",
            }}
          />
        </div>
      )}

      {/* TV viewport: full screen bg, centres the 16:9 canvas */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0A1F44",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* 16:9 scaled canvas — absolutely positioned so the scaled size doesn't overflow layout */}
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: TV_W,
            height: TV_H,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
            overflow: "hidden",
            background: "#F5F7FA",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          {/* ── NAVBAR ── */}
          <div
            style={{
              background: "#0A1F44",
              borderBottom: "4px solid #FF6B35",
              height: NAV_H,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 28px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  background: "#FF6B35",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 16,
                  color: "#fff",
                  letterSpacing: "-0.02em",
                }}
              >
                GC
              </div>
              <span
                style={{ fontWeight: 800, fontSize: 22, color: "#fff", letterSpacing: "-0.02em" }}
              >
                GoComet BDR Dashboard
              </span>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(255,107,53,0.14)",
                color: "#FF6B35",
                border: "1px solid rgba(255,107,53,0.35)",
                borderRadius: 24,
                padding: "5px 18px",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#FF6B35",
                  display: "inline-block",
                  animation: "livePulse 1.5s infinite",
                }}
              />
              LIVE
            </div>
          </div>

          {/* ── BODY ── */}
          <div
            style={{
              display: "flex",
              gap: PADDING,
              padding: PADDING,
              height: TV_H - NAV_H,
              background: "#F0F2F5",
            }}
          >
            {/* ── LEFT PANEL: Leaderboard ── */}
            <div
              style={{
                width: LEFT_W,
                flexShrink: 0,
                background: "#fff",
                borderRadius: 12,
                boxShadow: "0 2px 16px rgba(10,31,68,0.09)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* panel header */}
              <div
                style={{
                  borderTop: "4px solid #FF6B35",
                  padding: "14px 32px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid #F0F0F0",
                  flexShrink: 0,
                  height: PANEL_HEADER_H,
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 26, color: "#0A1F44" }}>
                  Meetings Leaderboard
                </span>
                <span style={{ color: "#9CA3AF", fontSize: 16 }}>
                  Last updated: {formatTime(leaderboardUpdated)}
                </span>
              </div>

              {/* #1 banner */}
              {top1 && (
                <div
                  key={top1.name}
                  style={{
                    position: "relative",
                    background: "linear-gradient(135deg, #0A1F44 0%, #1a3a6e 100%)",
                    padding: "20px 32px",
                    display: "flex",
                    alignItems: "center",
                    gap: 28,
                    height: TOP1_BANNER_H,
                    flexShrink: 0,
                    opacity: gifFadeIn ? 1 : 0,
                    transition: "opacity 0.5s ease",
                    animation: "fadeInGif 0.5s ease both",
                  }}
                >
                  {topChanged && <Confetti />}

                  <div
                    style={{
                      width: 140,
                      height: 140,
                      borderRadius: 14,
                      overflow: "hidden",
                      border: "4px solid #FF6B35",
                      flexShrink: 0,
                      background: "#0A1F44",
                    }}
                  >
                    {top1GifUrl ? (
                      <img
                        src={top1GifUrl}
                        alt={top1.name}
                        onError={handleGifError}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          background: "linear-gradient(135deg,#FF6B35,#FF8C42)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 56,
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
                        fontSize: 16,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        marginBottom: 8,
                      }}
                    >
                      👑 #1 This Week
                    </div>
                    <div style={{ color: "#fff", fontSize: 40, fontWeight: 800, lineHeight: 1.15 }}>
                      {top1.name}
                    </div>
                    <div style={{ color: "#FF6B35", fontSize: 26, fontWeight: 700, marginTop: 8 }}>
                      {top1.meetings} meetings
                    </div>
                  </div>
                </div>
              )}

              {/* empty state */}
              {leaderboard.length === 0 && (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#9CA3AF",
                    fontSize: 16,
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 44 }}>📋</span>
                  <span>
                    Update{" "}
                    <code style={{ color: "#1E90FF", fontSize: 13 }}>LEADERBOARD_CSV_URL</code>{" "}
                    to load data
                  </span>
                </div>
              )}

              {/* table */}
              {leaderboard.length > 0 && (
                <div style={{ flex: 1, overflowY: "hidden", height: TABLE_H }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr
                        style={{
                          background: "#F9FAFB",
                          borderBottom: "1px solid #E5E7EB",
                          position: "sticky",
                          top: 0,
                        }}
                      >
                        <th
                          style={{
                            padding: "12px 32px",
                            textAlign: "left",
                            fontSize: 17,
                            fontWeight: 700,
                            color: "#9CA3AF",
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            width: 100,
                          }}
                        >
                          Rank
                        </th>
                        <th
                          style={{
                            padding: "12px 32px",
                            textAlign: "left",
                            fontSize: 17,
                            fontWeight: 700,
                            color: "#9CA3AF",
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                          }}
                        >
                          Name
                        </th>
                        <th
                          style={{
                            padding: "12px 32px",
                            textAlign: "right",
                            fontSize: 17,
                            fontWeight: 700,
                            color: "#9CA3AF",
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            width: 180,
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
                          className={`lb-row ${i === 0 ? "gold-row" : ""}`}
                          style={{
                            borderBottom: "1px solid #F3F4F6",
                            animationDelay: `${i * 0.04}s`,
                          }}
                        >
                          <td
                            style={{
                              padding: "16px 32px",
                              fontSize: 22,
                              fontWeight: 700,
                              color: i === 0 ? "#D97706" : "#9CA3AF",
                            }}
                          >
                            {i === 0 ? (
                              <span style={{ display: "flex", alignItems: "center" }}>
                                <span style={{ marginRight: 6 }}>👑</span>1
                              </span>
                            ) : (
                              `#${i + 1}`
                            )}
                          </td>
                          <td
                            style={{
                              padding: "16px 32px",
                              fontSize: 24,
                              fontWeight: i === 0 ? 700 : 500,
                              color: i === 0 ? "#1A1A2E" : "#374151",
                            }}
                          >
                            {row.name}
                          </td>
                          <td
                            style={{
                              padding: "16px 32px",
                              textAlign: "right",
                              fontSize: 28,
                              fontWeight: 800,
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

              {/* insight ticker */}
              <InsightTicker insights={insights} />

              {/* footer */}
              <div
                style={{
                  padding: "0 32px",
                  height: PANEL_FOOTER_H,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  borderTop: "1px solid #F0F0F0",
                  color: "#C4C9D4",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                Auto-refreshes every 30s
              </div>
            </div>

            {/* ── RIGHT PANEL: Pipeline ── */}
            <div
              style={{
                flex: 1,
                background: "#fff",
                borderRadius: 12,
                boxShadow: "0 2px 16px rgba(10,31,68,0.09)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* panel header */}
              <div
                style={{
                  borderTop: "3px solid #FF6B35",
                  padding: "14px 24px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: "1px solid #F0F0F0",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 18, color: "#0A1F44" }}>
                  Pipeline Overview
                </span>
                <span style={{ color: "#9CA3AF", fontSize: 13 }}>
                  Last updated: {formatTime(pipelineUpdated)}
                </span>
              </div>

              {/* chart area */}
              <div style={{ flex: 1, padding: "20px 24px 12px", minHeight: 0 }}>
                {pipeline.length === 0 ? (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#9CA3AF",
                      fontSize: 16,
                      gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 44 }}>📊</span>
                    <span>
                      Update{" "}
                      <code style={{ color: "#1E90FF", fontSize: 13 }}>PIPELINE_CSV_URL</code>{" "}
                      to load data
                    </span>
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
                      color: "#9CA3AF",
                      fontSize: 15,
                    }}
                  >
                    Loading chart…
                  </div>
                )}
              </div>

              {/* footer */}
              <div
                style={{
                  padding: "8px 24px",
                  borderTop: "1px solid #F0F0F0",
                  color: "#C4C9D4",
                  fontSize: 12,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                Auto-refreshes every 30s
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
