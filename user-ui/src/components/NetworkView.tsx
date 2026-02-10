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

interface NetworkViewProps {
  users: User[];
  admin: AdminState;
  /** Active animated transactions (will be fed by WebSocket later). */
  transactions: NetworkTransaction[];
  onSelectUser: (id: string) => void;
}

const TX_DURATION_MS = 1200;
const NODE_RADIUS = 18;
const NODE_RADIUS_HOVER = 22;
const ADMIN_RADIUS = 28;
const ADMIN_RADIUS_HOVER = 32;

export function NetworkView({ users, admin, transactions, onSelectUser }: NetworkViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, forceRender] = useState(0);
  const rafRef = useRef<number>(0);
  /** Track the first render frame for each transaction so animations always start from 0% */
  const firstSeenRef = useRef(new Map<string, number>());

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    if (transactions.length === 0) return;

    const tick = () => {
      forceRender((n) => n + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [transactions.length]);

  const cx = containerSize.width / 2;
  const cy = containerSize.height / 2;

  // Layout: admin at center, users on the orbital ring
  const nodePositions = useMemo(() => {
    const radiusX = Math.min(containerSize.width, containerSize.height) * 0.38;
    const radiusY = radiusX * 0.85;

    return users.map((user, i) => {
      const angle = (2 * Math.PI * i) / users.length - Math.PI / 2;
      return {
        id: user.id,
        x: cx + radiusX * Math.cos(angle),
        y: cy + radiusY * Math.sin(angle),
        user,
      };
    });
  }, [users, containerSize, cx, cy]);

  // Position map includes admin
  const positionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    map.set('admin', { x: cx, y: cy });
    for (const n of nodePositions) map.set(n.id, { x: n.x, y: n.y });
    return map;
  }, [nodePositions, cx, cy]);

  const handleNodeClick = useCallback(
    (id: string) => onSelectUser(id),
    [onSelectUser],
  );

  const now = performance.now();

  // Clean up first-seen entries for transactions that no longer exist
  const activeIds = new Set(transactions.map((t) => t.id));
  for (const id of firstSeenRef.current.keys()) {
    if (!activeIds.has(id)) firstSeenRef.current.delete(id);
  }

  const isAdminHovered = hoveredId === 'admin';
  const adminR = isAdminHovered ? ADMIN_RADIUS_HOVER : ADMIN_RADIUS;

  return (
    <div className="network-view" ref={containerRef}>
      <div className="network-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
          />
        </svg>
        Network View
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
        </defs>

        {/* Hub-and-spoke lines: admin center to every user */}
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

        {/* Animated transaction lines */}
        {transactions.map((tx) => {
          const from = positionMap.get(tx.from);
          const to = positionMap.get(tx.to);
          if (!from || !to) return null;

          // Use first-seen time so animation always starts at 0% on first render frame
          if (!firstSeenRef.current.has(tx.id)) {
            firstSeenRef.current.set(tx.id, now);
          }
          const elapsed = now - firstSeenRef.current.get(tx.id)!;
          const progress = Math.min(elapsed / TX_DURATION_MS, 1);
          if (progress >= 1) return null;

          const px = from.x + (to.x - from.x) * progress;
          const py = from.y + (to.y - from.y) * progress;

          const trailLength = 0.25;
          const trailProgress = Math.max(0, progress - trailLength);
          const tx1 = from.x + (to.x - from.x) * trailProgress;
          const ty1 = from.y + (to.y - from.y) * trailProgress;

          return (
            <g key={tx.id}>
              <line
                x1={tx1}
                y1={ty1}
                x2={px}
                y2={py}
                className="network-tx-trail"
                strokeOpacity={1 - progress * 0.5}
              />
              <circle
                cx={px}
                cy={py}
                r={5}
                className="network-tx-particle"
                opacity={1 - progress * 0.3}
              />
              <text
                x={px}
                y={py - 12}
                className="network-tx-amount"
                textAnchor="middle"
                opacity={Math.min(1, (1 - progress) * 2)}
              >
                {formatBalance(tx.amount)}
              </text>
            </g>
          );
        })}

        {/* Admin center node */}
        <g
          className="network-node network-admin-node"
          onMouseEnter={() => setHoveredId('admin')}
          onMouseLeave={() => setHoveredId(null)}
          onClick={() => handleNodeClick('admin')}
          style={{ cursor: 'pointer' }}
        >
          {/* Permanent subtle glow ring */}
          <circle
            cx={cx}
            cy={cy}
            r={adminR + 8}
            fill="#9945ff"
            opacity={isAdminHovered ? 0.2 : 0.08}
            filter="url(#admin-glow)"
          />

          {/* Main circle */}
          <circle
            cx={cx}
            cy={cy}
            r={adminR}
            fill="#9945ff"
            className="network-node-circle"
          />

          {/* Shield icon */}
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
      </svg>

      {/* Hover tooltip */}
      {hoveredId && (() => {
        const pos = positionMap.get(hoveredId);
        if (!pos) return null;

        const isAdmin = hoveredId === 'admin';
        const user = isAdmin ? null : users.find((u) => u.id === hoveredId);
        if (!isAdmin && !user) return null;

        const hoverR = isAdmin ? ADMIN_RADIUS_HOVER : NODE_RADIUS_HOVER;
        const tooltipX = pos.x;
        const tooltipY = pos.y - hoverR - 16;

        return (
          <div
            className="network-tooltip"
            style={{ left: tooltipX, top: tooltipY }}
          >
            <div className="network-tooltip-name">
              {isAdmin ? 'Contra Admin' : `${user!.firstName} ${user!.lastName}`}
            </div>
            <div className="network-tooltip-balance">
              {formatBalance(isAdmin ? admin.balance : user!.balance)} USDA
            </div>
          </div>
        );
      })()}
    </div>
  );
}
