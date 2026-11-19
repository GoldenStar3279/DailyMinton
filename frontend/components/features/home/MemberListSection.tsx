"use client";

import React, { useMemo, useState } from "react";
import { GenderBadge } from "@/components/common/GenderBadge";
import type { MemberDto, MemberRole, MemberSortMode } from "@/types/home";

interface MemberListSectionProps {
  members: MemberDto[];
  totalCount: number;
  isLeaderView: boolean;
  onToggleStaffRole: (memberId: number, nextRole: "ADMIN" | "MEMBER") => void;
  onKickMember: (memberId: number, memberName: string) => void;
}

const ROLE_PRIORITY: Record<MemberRole, number> = {
  LEADER: 0,
  ADMIN: 1,
  MEMBER: 2,
};

/**
 * 모임 멤버 리스트 컴포넌트
 * - 회원 검색란 (이름/소모임 닉네임 실시간 검색)
 * - 정렬 전환 (운영진 우선 · 최근가입자 우선)
 * - 모임장 전용 운영진 권한 부여/회수 버튼 및 강퇴 버튼
 */
const MemberListSectionComponent: React.FC<MemberListSectionProps> = ({
  members,
  totalCount,
  isLeaderView,
  onToggleStaffRole,
  onKickMember,
}) => {
  const [sortMode, setSortMode] =
    useState<MemberSortMode>("ADMIN_THEN_LATEST");
  const [memberSearch, setMemberSearch] = useState("");

  const sortedMembers = useMemo(() => {
    const keyword = memberSearch.trim().toLowerCase();
    const filtered = keyword
      ? members.filter(
          (m) =>
            m.name.toLowerCase().includes(keyword) ||
            m.nickname.toLowerCase().includes(keyword)
        )
      : members;

    return [...filtered].sort((a, b) => {
      if (sortMode === "ADMIN_THEN_LATEST") {
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) {
          return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        }
        return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
      }

      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
    });
  }, [members, sortMode, memberSearch]);

  return (
    <section aria-labelledby="member-list-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="member-list-heading"
          className="text-[18px] font-bold tracking-tight text-zinc-100"
        >
          모임 멤버 {totalCount}
        </h2>
        {isLeaderView && (
          <span className="text-xs text-amber-300/90">
            ★ 모임장 권한: 운영진 부여·회수 및 강퇴 가능
          </span>
        )}
      </div>

      {/* 모임 멤버 검색란 + 정렬 전환 바 */}
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <search className="w-full sm:max-w-xs">
          <div className="relative">
            <label htmlFor="member-list-search-input" className="sr-only">
              모임 멤버 검색
            </label>
            <input
              id="member-list-search-input"
              type="search"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="회원 이름 또는 닉네임 검색..."
              className="w-full rounded-lg border border-zinc-800 bg-[#151821] py-2 pr-8 pl-3.5 text-xs text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
            />
            {memberSearch && (
              <button
                type="button"
                onClick={() => setMemberSearch("")}
                aria-label="검색어 지우기"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            )}
          </div>
        </search>

        <button
          type="button"
          onClick={() =>
            setSortMode((prev) =>
              prev === "ADMIN_THEN_LATEST"
                ? "LATEST_FIRST"
                : "ADMIN_THEN_LATEST"
            )
          }
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-zinc-400 transition hover:text-zinc-100 sm:self-auto"
        >
          <span>
            {sortMode === "ADMIN_THEN_LATEST"
              ? "최근가입 (운영진 우선 · 신규 가입자 상단)"
              : "최근가입 (전체 신규 가입자 상단)"}
          </span>
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-zinc-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
          </svg>
        </button>
      </div>

      {sortedMembers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-xs text-zinc-500">
          &ldquo;{memberSearch}&rdquo; 검색 결과와 일치하는 회원이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {sortedMembers.map((member) => {
            const isLeader = member.role === "LEADER";
            const isStaff = member.role === "ADMIN";
            const isFemale = member.gender === "FEMALE";

            return (
              <li
                key={member.id}
                className={`flex flex-col gap-2.5 rounded-xl border px-3.5 py-2.5 transition sm:flex-row sm:items-center sm:justify-between ${
                  isFemale
                    ? "border-pink-400/35 bg-pink-500/12 hover:border-pink-400/55 hover:bg-pink-500/18"
                    : "border-sky-400/30 bg-sky-500/10 hover:border-sky-400/50 hover:bg-sky-500/15"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  {/* 프로필 아바타 및 운영진 배지 */}
                  <div className="relative h-11 w-11 shrink-0">
                    <div
                      style={{ background: member.avatarGradient }}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-white shadow-2xs"
                    >
                      <span aria-hidden="true">{member.avatarEmoji}</span>
                    </div>

                    {(isLeader || isStaff) && (
                      <span
                        className={`absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white ring-2 ring-[#151821] ${
                          isLeader ? "bg-[#f5b82e]" : "bg-[#f28395]"
                        }`}
                        title={isLeader ? "모임장" : "운영진"}
                      >
                        ★
                      </span>
                    )}
                  </div>

                  {/* 이름, 직책/성별 형광펜 배지, 인사말 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`h-3.5 w-1 shrink-0 rounded-full ${
                          isFemale ? "bg-pink-400" : "bg-sky-400"
                        }`}
                      />
                      <span className="text-[14.5px] font-bold text-white">
                        {member.name}
                      </span>
                      {member.nickname !== member.name && (
                        <span className="text-xs font-medium text-zinc-300">
                          ({member.nickname})
                        </span>
                      )}

                      {(isLeader || isStaff) && (
                        <span
                          className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            isLeader
                              ? "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30"
                              : "bg-rose-400/20 text-rose-300 ring-1 ring-rose-400/30"
                          }`}
                        >
                          {isLeader ? "모임장" : "운영진"}
                        </span>
                      )}

                      <GenderBadge
                        gender={member.gender}
                        grade={member.grade}
                        ageGroup={member.ageGroup}
                      />

                      <span className="whitespace-nowrap text-[11px] text-zinc-400">
                        {member.joinedAt} 가입
                      </span>
                    </div>

                    <p className="mt-0.5 truncate pl-3 text-[13px] text-zinc-300/80">
                      {member.bio}
                    </p>
                  </div>
                </div>

                {/* 우측 모임장 전용 운영진 권한 부여/회수 + 강퇴 버튼 */}
                {isLeaderView && !isLeader && (
                  <div className="flex shrink-0 items-center justify-end gap-1.5 pl-14 sm:pl-0">
                    {isStaff ? (
                      <button
                        type="button"
                        onClick={() => onToggleStaffRole(member.id, "MEMBER")}
                        className="whitespace-nowrap rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/30"
                      >
                        운영진 회수
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleStaffRole(member.id, "ADMIN")}
                        className="whitespace-nowrap rounded-lg border border-amber-400/40 bg-amber-500/20 px-2.5 py-1.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/35"
                      >
                        + 운영진 부여
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onKickMember(member.id, member.name)}
                      className="whitespace-nowrap rounded-lg border border-red-500/40 bg-red-500/20 px-2.5 py-1.5 text-xs font-bold text-red-200 transition hover:bg-red-500/35"
                    >
                      강퇴
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export const MemberListSection = React.memo(MemberListSectionComponent);
