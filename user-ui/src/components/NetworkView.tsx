import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { User, AdminState } from '../types/user.ts';
import { formatBalance } from '../utils/formatters.ts';

/** A single animated transaction flying between two nodes. */
export interface NetworkTransaction {
  id: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
}

type ViewMode = 'network' | 'mainnet';

interface NetworkViewProps {
  users: User[];
  admin: AdminState;
  transactions: NetworkTransaction[];
  onSelectUser: (id: string) => void;
  liveTransactionsActive?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TX_DURATION_MS = 1400;
const NODE_RADIUS = 18;
const NODE_RADIUS_HOVER = 22;
const ADMIN_RADIUS = 28;
const ADMIN_RADIUS_HOVER = 32;
const ADMIN_COLOR = '#9945ff';
const ESCROW_COLOR = '#14b8a6';
const ESCROW_RECT_W = 52;
const ESCROW_RECT_H = 44;
const ESCROW_BALANCE = 50_000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

const ADMIN_RGB = hexToRgb(ADMIN_COLOR);
const ESCROW_RGB = hexToRgb(ESCROW_COLOR);

/** IDs that live on the mainnet side (outside the Contra bubble). */
const MAINNET_IDS = new Set(['escrow', 'offscreen-left']);

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function NetworkView({
  users,
  admin,
  transactions,
  onSelectUser,
  liveTransactionsActive = false,
}: NetworkViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('network');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [escrowTxs, setEscrowTxs] = useState<NetworkTransaction[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, forceRender] = useState(0);
  const rafRef = useRef<number>(0);

  /** Track completed pulses: nodeId lets us filter by view mode. */
  const completedRef = useRef(
    new Map<string, { x: number; y: number; color: string; time: number; nodeId: string }>(),
  );

  const usersRef = useRef(users);
  usersRef.current = users;

  const isMainnet = viewMode === 'mainnet';

  /* ---- Layout ---- */
  const cx = containerSize.width * 0.55;
  const cy = containerSize.height / 2;

  const escrowX = containerSize.width * 0.08;
  const escrowY = cy;

  const radiusX = Math.min(containerSize.width, containerSize.height) * 0.34;
  const radiusY = radiusX * 0.85;

  const bubbleRx = radiusX + 50;
  const bubbleRy = radiusY + 50;
  const bubbleLeftX = cx - bubbleRx;

  /* ---- Node positions ---- */
  const nodePositions = useMemo(() => {
    const rX = Math.min(containerSize.width, containerSize.height) * 0.34;
    const rY = rX * 0.85;
    return users.map((user, i) => {
      const angle = (2 * Math.PI * i) / users.length - Math.PI / 2;
      return {
        id: user.id,
        x: cx + rX * Math.cos(angle),
        y: cy + rY * Math.sin(angle),
        user,
      };
    });
  }, [users, containerSize, cx, cy]);

  /* ---- Color map ---- */
  const colorMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    map.set('admin', ADMIN_RGB);
    map.set('escrow', ESCROW_RGB);
    map.set('offscreen-left', ESCROW_RGB);
    for (const n of nodePositions) {
      map.set(n.id, hexToRgb(n.user.avatarColor));
    }
    return map;
  }, [nodePositions]);

  /* ---- Position map (includes escrow + offscreen) ---- */
  const positionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    map.set('admin', { x: cx, y: cy });
    map.set('escrow', { x: escrowX, y: escrowY });
    map.set('offscreen-left', { x: -30, y: cy });
    for (const n of nodePositions) map.set(n.id, { x: n.x, y: n.y });
    return map;
  }, [nodePositions, cx, cy, escrowX, escrowY]);

  /* ---- Combined & visible transactions ---- */
  const allTransactions = useMemo(
    () => [...transactions, ...escrowTxs],
    [transactions, escrowTxs],
  );

  const visibleTransactions = useMemo(() => {
    if (!isMainnet) return allTransactions;
    // Mainnet: only show legs where BOTH endpoints are on the mainnet side
    return allTransactions.filter((tx) => MAINNET_IDS.has(tx.from) && MAINNET_IDS.has(tx.to));
  }, [isMainnet, allTransactions]);

  const txRef = useRef(allTransactions);
  txRef.current = allTransactions;

  /* ---- Resize observer ---- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ---- Animation loop ---- */
  useEffect(() => {
    let running = true;
    function tick() {
      if (!running) return;
      forceRender((n) => n + 1);
      if (txRef.current.length > 0 || completedRef.current.size > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    if (allTransactions.length > 0 || completedRef.current.size > 0) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [allTransactions]);

  /* ---- Escrow transaction generator ---- */
  useEffect(() => {
    if (!liveTransactionsActive) return;
    let running = true;

    function addTx(tx: NetworkTransaction) {
      setEscrowTxs((prev) => [...prev, tx]);
      setTimeout(() => {
        setEscrowTxs((prev) => prev.filter((t) => t.id !== tx.id));
      }, TX_DURATION_MS + 200);
    }

    function generate() {
      if (!running) return;
      const currentUsers = usersRef.current;
      if (currentUsers.length === 0) {
        setTimeout(generate, 2000);
        return;
      }

      const isDeposit = Math.random() > 0.5;
      const randomUser = currentUsers[Math.floor(Math.random() * currentUsers.length)];
      const amount = Math.round((Math.random() * 200 + 20) * 100) / 100;
      const baseId = `escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (isDeposit) {
        // Leg 1: off-screen -> escrow
        addTx({
          id: `${baseId}-l1`,
          from: 'offscreen-left',
          to: 'escrow',
          amount,
          timestamp: performance.now(),
        });
        // Leg 2: escrow -> random user (after leg 1 completes)
        setTimeout(() => {
          if (!running) return;
          addTx({
            id: `${baseId}-l2`,
            from: 'escrow',
            to: randomUser.id,
            amount,
            timestamp: performance.now(),
          });
        }, TX_DURATION_MS + 100);
      } else {
        // Leg 1: random user -> escrow
        addTx({
          id: `${baseId}-l1`,
          from: randomUser.id,
          to: 'escrow',
          amount,
          timestamp: performance.now(),
        });
        // Leg 2: escrow -> off-screen (after leg 1 completes)
        setTimeout(() => {
          if (!running) return;
          addTx({
            id: `${baseId}-l2`,
            from: 'escrow',
            to: 'offscreen-left',
            amount,
            timestamp: performance.now(),
          });
        }, TX_DURATION_MS + 100);
      }

      const nextDelay = 3000 + Math.random() * 4000;
      setTimeout(() => {
        if (running) generate();
      }, nextDelay);
    }

    const t = setTimeout(generate, 1500 + Math.random() * 1500);
    return () => {
      running = false;
      clearTimeout(t);
    };
  }, [liveTransactionsActive]);

  /* ---- Handlers ---- */
  const handleNodeClick = useCallback(
    (id: string) => onSelectUser(id),
    [onSelectUser],
  );

  /* ---- Per-frame calculations ---- */
  const now = performance.now();

  // Clean up old completed pulses (fade over 600ms)
  for (const [id, entry] of completedRef.current.entries()) {
    if (now - entry.time > 600) completedRef.current.delete(id);
  }

  const isAdminHovered = hoveredId === 'admin';
  const isEscrowHovered = hoveredId === 'escrow';
  const adminR = isAdminHovered ? ADMIN_RADIUS_HOVER : ADMIN_RADIUS;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="network-view" ref={containerRef}>
      {/* ---- Dropdown title bar ---- */}
      <div className="network-title">
        <select
          className="network-view-select"
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as ViewMode)}
        >
          <option value="network">Network View</option>
          <option value="mainnet">Mainnet View</option>
        </select>
        <span className="network-title-count">{users.length} users</span>
      </div>

      <svg
        ref={svgRef}
        className="network-svg"
        width={containerSize.width}
        height={containerSize.height}
        viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
      >
        <defs>
          {/* --- Filters --- */}
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="admin-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="tx-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="escrow-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Drop shadow: top-down light, shadow falls below */}
          <filter id="drop-shadow" x="-30%" y="-20%" width="160%" height="180%">
            <feDropShadow dx={0} dy={3} stdDeviation={4} floodColor="#000" floodOpacity={0.5} />
          </filter>

          {/* Soft ambient glow behind the bubble */}
          <filter id="bubble-ambient" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="30" />
          </filter>

          {/* --- Gradients for 3D node shading --- */}
          {/* Top-lit sphere: white highlight top, dark shadow bottom */}
          <linearGradient id="node-3d" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity={0.22} />
            <stop offset="40%" stopColor="white" stopOpacity={0.04} />
            <stop offset="70%" stopColor="black" stopOpacity={0.05} />
            <stop offset="100%" stopColor="black" stopOpacity={0.2} />
          </linearGradient>

          {/* Specular highlight dot (top-left) */}
          <radialGradient id="specular" cx="35%" cy="30%" r="35%">
            <stop offset="0%" stopColor="white" stopOpacity={0.35} />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>

          {/* Escrow rect 3D overlay */}
          <linearGradient id="rect-3d" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity={0.18} />
            <stop offset="35%" stopColor="white" stopOpacity={0.02} />
            <stop offset="100%" stopColor="black" stopOpacity={0.2} />
          </linearGradient>

          {/* --- Bubble gradients --- */}
          {/* Main fill: lit from above, dark edges like a sphere */}
          <radialGradient id="bubble-fill" cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#2d2d38" />
            <stop offset="35%" stopColor="#242430" />
            <stop offset="70%" stopColor="#1a1a24" />
            <stop offset="100%" stopColor="#111118" />
          </radialGradient>

          {/* Specular crescent on the bubble top */}
          <radialGradient id="bubble-spec" cx="50%" cy="0%" r="70%">
            <stop offset="0%" stopColor="white" stopOpacity={0.07} />
            <stop offset="60%" stopColor="white" stopOpacity={0.01} />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </radialGradient>

          {/* Rim light gradient for bubble stroke */}
          <linearGradient id="bubble-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9945ff" stopOpacity={0.6} />
            <stop offset="50%" stopColor="#9945ff" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#9945ff" stopOpacity={0.05} />
          </linearGradient>

          {/* Network boundary soft glow ring */}
          <radialGradient id="ring-fade" cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor={ADMIN_COLOR} stopOpacity={0} />
            <stop offset="95%" stopColor={ADMIN_COLOR} stopOpacity={0.06} />
            <stop offset="100%" stopColor={ADMIN_COLOR} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* ============================================================ */}
        {/*  NETWORK MODE: internal Contra elements                       */}
        {/* ============================================================ */}
        {!isMainnet && (
          <>
            {/* Soft glow ring around Contra boundary */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={bubbleRx}
              ry={bubbleRy}
              fill="url(#ring-fade)"
            />
            {/* Crisp dashed boundary */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={bubbleRx}
              ry={bubbleRy}
              fill="none"
              stroke={ADMIN_COLOR}
              strokeWidth={1}
              strokeDasharray="6 5"
              strokeOpacity={0.18}
            />

            {/* Hub-and-spoke lines */}
            {nodePositions.map((node) => (
              <line
                key={`spoke-${node.id}`}
                x1={cx}
                y1={cy}
                x2={node.x}
                y2={node.y}
                className="network-admin-spoke"
              />
            ))}

            {/* Completed destination pulses (internal only) */}
            {[...completedRef.current.entries()]
              .filter(([, entry]) => !MAINNET_IDS.has(entry.nodeId))
              .map(([id, entry]) => {
                const pulseElapsed = now - entry.time;
                const pulseProgress = Math.min(pulseElapsed / 600, 1);
                const pulseR = NODE_RADIUS + pulseProgress * 20;
                const pulseOpacity = 0.5 * (1 - pulseProgress);
                return (
                  <circle
                    key={`pulse-${id}`}
                    cx={entry.x}
                    cy={entry.y}
                    r={pulseR}
                    fill="none"
                    stroke={entry.color}
                    strokeWidth={2 - pulseProgress * 1.5}
                    opacity={pulseOpacity}
                  />
                );
              })}

            {/* Admin center node */}
            <g
              className="network-node network-admin-node"
              onMouseEnter={() => setHoveredId('admin')}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => handleNodeClick('admin')}
              style={{ cursor: 'pointer' }}
              filter="url(#drop-shadow)"
            >
              <circle
                cx={cx}
                cy={cy}
                r={adminR + 8}
                fill={ADMIN_COLOR}
                opacity={isAdminHovered ? 0.2 : 0.08}
                filter="url(#admin-glow)"
              />
              <circle cx={cx} cy={cy} r={adminR} fill={ADMIN_COLOR} className="network-node-circle" />
              {/* 3D depth: lit top, shadowed bottom */}
              <circle cx={cx} cy={cy} r={adminR} fill="url(#node-3d)" pointerEvents="none" />
              {/* Specular highlight */}
              <circle cx={cx} cy={cy} r={adminR} fill="url(#specular)" pointerEvents="none" />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                className="network-node-initials network-admin-initials"
              >
                CA
              </text>
            </g>

            {/* User nodes */}
            {nodePositions.map((node) => {
              const isHovered = hoveredId === node.id;
              const r = isHovered ? NODE_RADIUS_HOVER : NODE_RADIUS;
              return (
                <g
                  key={node.id}
                  className="network-node"
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => handleNodeClick(node.id)}
                  style={{ cursor: 'pointer' }}
                  filter="url(#drop-shadow)"
                >
                  {isHovered && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={r + 6}
                      fill={node.user.avatarColor}
                      opacity={0.15}
                      filter="url(#node-glow)"
                    />
                  )}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    fill={node.user.avatarColor}
                    className="network-node-circle"
                  />
                  {/* 3D depth overlay */}
                  <circle cx={node.x} cy={node.y} r={r} fill="url(#node-3d)" pointerEvents="none" />
                  {/* Specular highlight */}
                  <circle cx={node.x} cy={node.y} r={r} fill="url(#specular)" pointerEvents="none" />
                  <text
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="network-node-initials"
                  >
                    {node.user.firstName[0]}
                    {node.user.lastName[0]}
                  </text>
                </g>
              );
            })}
          </>
        )}

        {/* ============================================================ */}
        {/*  MAINNET MODE: privacy bubble                                 */}
        {/* ============================================================ */}
        {isMainnet && (
          <g>
            {/* Ambient glow behind the bubble */}
            <ellipse
              cx={cx}
              cy={cy + 10}
              rx={bubbleRx * 0.7}
              ry={bubbleRy * 0.5}
              fill={ADMIN_COLOR}
              opacity={0.04}
              filter="url(#bubble-ambient)"
            />

            {/* Main bubble body with sphere-like radial gradient */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={bubbleRx}
              ry={bubbleRy}
              fill="url(#bubble-fill)"
            />

            {/* Rim light stroke: bright top, fades at bottom */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={bubbleRx}
              ry={bubbleRy}
              fill="none"
              stroke="url(#bubble-rim)"
              strokeWidth={1.5}
            />

            {/* Dashed outer ring for texture */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={bubbleRx + 4}
              ry={bubbleRy + 4}
              fill="none"
              stroke={ADMIN_COLOR}
              strokeWidth={0.5}
              strokeDasharray="4 6"
              strokeOpacity={0.15}
            />

            {/* Specular crescent at top */}
            <ellipse
              cx={cx}
              cy={cy - bubbleRy * 0.35}
              rx={bubbleRx * 0.55}
              ry={bubbleRy * 0.3}
              fill="url(#bubble-spec)"
            />

            {/* Inner bottom shadow for depth */}
            <ellipse
              cx={cx}
              cy={cy + bubbleRy * 0.3}
              rx={bubbleRx * 0.8}
              ry={bubbleRy * 0.35}
              fill="black"
              opacity={0.12}
            />

            <text
              x={cx}
              y={cy - 14}
              textAnchor="middle"
              dominantBaseline="central"
              className="network-bubble-title"
            >
              Contra Network
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              dominantBaseline="central"
              className="network-bubble-subtitle"
            >
              Transactions are not visible on mainnet
            </text>
          </g>
        )}

        {/* ============================================================ */}
        {/*  NETWORK MODE ONLY: Dashed line from escrow to bubble edge    */}
        {/* ============================================================ */}
        {!isMainnet && (
          <line
            x1={escrowX + ESCROW_RECT_W / 2 + 4}
            y1={escrowY}
            x2={bubbleLeftX}
            y2={cy}
            stroke={ESCROW_COLOR}
            strokeWidth={1}
            strokeDasharray="6 4"
            strokeOpacity={0.25}
          />
        )}

        {/* ============================================================ */}
        {/*  ALWAYS: Escrow destination pulses                            */}
        {/* ============================================================ */}
        {[...completedRef.current.entries()]
          .filter(([, entry]) => entry.nodeId === 'escrow')
          .map(([id, entry]) => {
            const pulseElapsed = now - entry.time;
            const pulseProgress = Math.min(pulseElapsed / 600, 1);
            const pulseR = ESCROW_RECT_W / 2 + pulseProgress * 16;
            const pulseOpacity = 0.5 * (1 - pulseProgress);
            return (
              <circle
                key={`pulse-${id}`}
                cx={entry.x}
                cy={entry.y}
                r={pulseR}
                fill="none"
                stroke={entry.color}
                strokeWidth={2 - pulseProgress * 1.5}
                opacity={pulseOpacity}
              />
            );
          })}

        {/* ============================================================ */}
        {/*  ALWAYS: Escrow contract node                                 */}
        {/* ============================================================ */}
        <g
          onMouseEnter={() => setHoveredId('escrow')}
          onMouseLeave={() => setHoveredId(null)}
          style={{ cursor: 'pointer' }}
          filter="url(#drop-shadow)"
        >
          {isEscrowHovered && (
            <rect
              x={escrowX - ESCROW_RECT_W / 2 - 4}
              y={escrowY - ESCROW_RECT_H / 2 - 4}
              width={ESCROW_RECT_W + 8}
              height={ESCROW_RECT_H + 8}
              rx={14}
              ry={14}
              fill={ESCROW_COLOR}
              opacity={0.15}
              filter="url(#escrow-glow)"
            />
          )}
          <rect
            x={escrowX - ESCROW_RECT_W / 2}
            y={escrowY - ESCROW_RECT_H / 2}
            width={ESCROW_RECT_W}
            height={ESCROW_RECT_H}
            rx={10}
            ry={10}
            fill={ESCROW_COLOR}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
          {/* 3D depth overlay */}
          <rect
            x={escrowX - ESCROW_RECT_W / 2}
            y={escrowY - ESCROW_RECT_H / 2}
            width={ESCROW_RECT_W}
            height={ESCROW_RECT_H}
            rx={10}
            ry={10}
            fill="url(#rect-3d)"
            pointerEvents="none"
          />
          <text
            x={escrowX}
            y={escrowY}
            textAnchor="middle"
            dominantBaseline="central"
            className="network-escrow-initials"
          >
            E
          </text>
          <text
            x={escrowX}
            y={escrowY + ESCROW_RECT_H / 2 + 16}
            textAnchor="middle"
            className="network-escrow-label"
          >
            Escrow
          </text>
          <text
            x={escrowX}
            y={escrowY + ESCROW_RECT_H / 2 + 30}
            textAnchor="middle"
            className="network-escrow-sublabel"
          >
            Mainnet
          </text>
        </g>

        {/* ============================================================ */}
        {/*  Transaction animations (filtered by view mode)               */}
        {/* ============================================================ */}
        {visibleTransactions.map((tx) => {
          const fromPos = positionMap.get(tx.from);
          const toPos = positionMap.get(tx.to);
          if (!fromPos || !toPos) return null;

          const elapsed = now - tx.timestamp;
          const rawProgress = Math.min(elapsed / TX_DURATION_MS, 1);
          if (rawProgress >= 1) {
            if (!completedRef.current.has(tx.id)) {
              const destColor = colorMap.get(tx.to);
              completedRef.current.set(tx.id, {
                x: toPos.x,
                y: toPos.y,
                color: destColor ? lerpColor(destColor, destColor, 1) : ADMIN_COLOR,
                time: now,
                nodeId: tx.to,
              });
            }
            return null;
          }

          const progress = easeOutCubic(rawProgress);
          const px = fromPos.x + (toPos.x - fromPos.x) * progress;
          const py = fromPos.y + (toPos.y - fromPos.y) * progress;

          const trailLen = 0.4;
          const trailStart = Math.max(0, progress - trailLen);
          const tx1 = fromPos.x + (toPos.x - fromPos.x) * trailStart;
          const ty1 = fromPos.y + (toPos.y - fromPos.y) * trailStart;

          const fromRgb = colorMap.get(tx.from) ?? ADMIN_RGB;
          const toRgb = colorMap.get(tx.to) ?? ADMIN_RGB;
          const headColor = lerpColor(fromRgb, toRgb, progress);
          const tailColor = lerpColor(fromRgb, toRgb, trailStart);

          const particleR = 4 + progress * 3;
          const fadeOpacity = rawProgress > 0.8 ? (1 - rawProgress) / 0.2 : 1;
          const gradId = `tx-grad-${tx.id}`;

          return (
            <g key={tx.id} opacity={fadeOpacity}>
              <defs>
                <linearGradient
                  id={gradId}
                  x1={tx1}
                  y1={ty1}
                  x2={px}
                  y2={py}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor={tailColor} stopOpacity={0} />
                  <stop offset="30%" stopColor={tailColor} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={headColor} stopOpacity={1} />
                </linearGradient>
              </defs>
              <line
                x1={tx1}
                y1={ty1}
                x2={px}
                y2={py}
                stroke={`url(#${gradId})`}
                strokeWidth={3}
                strokeLinecap="round"
              />
              <circle
                cx={px}
                cy={py}
                r={particleR + 4}
                fill={headColor}
                opacity={0.25}
                filter="url(#tx-glow)"
              />
              <circle cx={px} cy={py} r={particleR} fill={headColor} />
              <text
                x={px}
                y={py - particleR - 8}
                textAnchor="middle"
                className="network-tx-amount"
                opacity={rawProgress < 0.15 ? rawProgress / 0.15 : 1}
              >
                {formatBalance(tx.amount)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* ---- Hover tooltip ---- */}
      {hoveredId &&
        (() => {
          const pos = positionMap.get(hoveredId);
          if (!pos) return null;

          const isEscrow = hoveredId === 'escrow';
          const isAdmin = hoveredId === 'admin';

          // In mainnet mode only the escrow tooltip is available
          if (isMainnet && !isEscrow) return null;

          const user = !isAdmin && !isEscrow ? users.find((u) => u.id === hoveredId) : null;
          if (!isAdmin && !isEscrow && !user) return null;

          const hoverR = isAdmin
            ? ADMIN_RADIUS_HOVER
            : isEscrow
              ? ESCROW_RECT_H / 2
              : NODE_RADIUS_HOVER;
          const tooltipX = pos.x;
          const tooltipY = pos.y - hoverR - 16;

          return (
            <div className="network-tooltip" style={{ left: tooltipX, top: tooltipY }}>
              <div className="network-tooltip-name">
                {isAdmin ? 'Contra Admin' : isEscrow ? 'Escrow Contract' : `${user!.firstName} ${user!.lastName}`}
              </div>
              <div className="network-tooltip-balance">
                {formatBalance(isAdmin ? admin.balance : isEscrow ? ESCROW_BALANCE : user!.balance)} USDA
              </div>
            </div>
          );
        })()}
    </div>
  );
}
