"use client";

import React from "react";
import type { SessionPlayer } from "@/types/session";

interface PlayerBlockProps {
  player: SessionPlayer;
  compact?: boolean;
  selected?: boolean;
  onClick?: () => void;
  actions?: React.ReactNode;
}

/**
 * 성별 구분 반투명 파스텔 형광펜 스타일 공통 선수 블록 컴포넌트
 * - 남성: 연한 스카이블루/민트 형광펜 톤
 * - 여성: 연한 핑크/로즈 형광펜 톤
 */
const PlayerBlockComponent: React.FC<PlayerBlockProps> = ({
  player,
  compact = false,
  selected = false,
  onClick,
  actions,
}) => {
  const isFemale = player.gender === "FEMALE";
  const isConsecutiveWarning = player.consecutiveGameCount >= 2;

  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center justify-between gap-2.5 rounded-xl border transition ${
        compact ? "px-3 py-2" : "px-3.5 py-3"
      } ${onClick ? "cursor-pointer" : ""} ${
        selected
          ? "border-amber-400 bg-amber-400/20 ring-2 ring-amber-400/50"
          : isFemale
            ? "border-pink-400/35 bg-pink-500/15 hover:border-pink-400/60 hover:bg-pink-500/20"
            : "border-sky-400/35 bg-sky-500/15 hover:border-sky-400/60 hover:bg-sky-500/20"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* 성별 형광펜 인디케이터 바 */}
          <span
            className={`h-4 w-1.5 shrink-0 rounded-full ${
              isFemale ? "bg-pink-400" : "bg-sky-400"
            }`}
          />

          <span
            className={`truncate font-bold text-white ${
              compact ? "text-sm sm:text-base" : "text-base sm:text-lg"
            }`}
          >
            {player.name}
          </span>

          {player.nickname !== player.name && !compact && (
            <span className="text-xs text-zinc-300 sm:text-sm">
              ({player.nickname})
            </span>
          )}

          {player.isGuest && (
            <span className="rounded bg-amber-400/25 px-2 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/40">
              게스트
            </span>
          )}

          <span
            className={`rounded px-2 py-0.5 text-xs font-bold sm:text-sm ${
              isFemale
                ? "bg-pink-400/25 text-pink-200"
                : "bg-sky-400/25 text-sky-200"
            }`}
          >
            {player.grade}조
          </span>

          {!compact && (
            <span className="text-xs font-medium text-zinc-300 sm:text-sm">
              {player.totalGameCount}게임
            </span>
          )}

          {isConsecutiveWarning && !compact && (
            <span
              className="rounded bg-orange-500/25 px-2 py-0.5 text-xs font-semibold text-orange-300"
              title="연속 2게임 이상 참여로 다음 자동매칭 시 후순위 배치"
            >
              연속 {player.consecutiveGameCount}G
            </span>
          )}
        </div>

        {!compact && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-3 text-xs text-zinc-300/90 sm:text-sm">
            <span className="font-semibold">ELO {Math.round(player.eloScore)}</span>
            <span>·</span>
            <span>
              {player.wins}승 {player.losses}패
            </span>
            {player.cockSubmitted && (
              <>
                <span>·</span>
                <span className="font-semibold text-emerald-300">
                  콕 {player.cockQuantity}개 제출
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {actions && (
        <div
          className="flex shrink-0 items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
};

export const PlayerBlock = React.memo(PlayerBlockComponent);
