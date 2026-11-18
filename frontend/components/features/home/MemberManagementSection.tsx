"use client";

import React, { useMemo, useState } from "react";
import { GenderBadge } from "@/components/common/GenderBadge";
import type {
  AgeGroup,
  Gender,
  Grade,
  MemberDto,
  MemberRole,
} from "@/types/home";

const ROLE_PRIORITY: Record<MemberRole, number> = {
  LEADER: 0,
  ADMIN: 1,
  MEMBER: 2,
};

type ManagementSortOption = "ROLE_THEN_LATEST" | "LATEST_ONLY" | "NAME_ASC";

interface MemberManagementSectionProps {
  members: MemberDto[];
  onOpenNewMemberModal: () => void;
  onToggleStaffRole: (memberId: number, nextRole: "ADMIN" | "MEMBER") => void;
  onUpdateMemberInfo: (
    memberId: number,
    updates: {
      gender?: Gender;
      grade?: Grade;
      ageGroup?: AgeGroup;
    }
  ) => void;
  onKickMember: (memberId: number, memberName: string) => void;
}

const ALL_GRADES: Grade[] = ["S", "A", "B", "C", "D", "E", "F", "G"];
const ALL_AGE_GROUPS: { value: AgeGroup; label: string }[] = [
  { value: "UNDER_10", label: "10대 미만" },
  { value: "20S", label: "20대" },
  { value: "30S", label: "30대" },
  { value: "40S", label: "40대" },
  { value: "50S", label: "50대" },
  { value: "60S", label: "60대" },
  { value: "OVER_70", label: "70대 이상" },
];

const MemberManagementSectionComponent: React.FC<
  MemberManagementSectionProps
> = ({
  members,
  onOpenNewMemberModal,
  onToggleStaffRole,
  onUpdateMemberInfo,
  onKickMember,
}) => {
  const [searchKeyword, setSearchKeyword] = useState("");
  const [genderFilter, setGenderFilter] = useState<"ALL" | Gender>("ALL");
  const [gradeFilter, setGradeFilter] = useState<"ALL" | Grade>("ALL");
  const [sortOption, setSortOption] =
    useState<ManagementSortOption>("ROLE_THEN_LATEST");

  const stats = useMemo(() => {
    const staffCount = members.filter(
      (m) => m.role === "LEADER" || m.role === "ADMIN"
    ).length;
    const maleCount = members.filter((m) => m.gender === "MALE").length;
    const femaleCount = members.filter((m) => m.gender === "FEMALE").length;
    return {
      total: members.length,
      staffCount,
      maleCount,
      femaleCount,
    };
  }, [members]);

  const filteredMembers = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    const filtered = members.filter((m) => {
      if (genderFilter !== "ALL" && m.gender !== genderFilter) return false;
      if (gradeFilter !== "ALL" && m.grade !== gradeFilter) return false;
      if (!kw) return true;
      return (
        m.name.toLowerCase().includes(kw) ||
        m.nickname.toLowerCase().includes(kw)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortOption === "ROLE_THEN_LATEST") {
        // 1순위: 모임장(LEADER) -> 운영진(ADMIN) -> 일반회원(MEMBER)
        if (ROLE_PRIORITY[a.role] !== ROLE_PRIORITY[b.role]) {
          return ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role];
        }
        // 2순위: 최근 가입자 순 (joinedAt 내림차순)
        const timeDiff =
          new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.name.localeCompare(b.name, "ko");
      }

      if (sortOption === "LATEST_ONLY") {
        const timeDiff =
          new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.name.localeCompare(b.name, "ko");
      }

      // NAME_ASC
      return a.name.localeCompare(b.name, "ko");
    });
  }, [members, searchKeyword, genderFilter, gradeFilter, sortOption]);

  return (
    <section aria-labelledby="member-management-heading" className="space-y-6">
      {/* 상단 제목 및 신입 회원 추가 버튼 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="member-management-heading"
            className="text-[18px] font-bold tracking-tight text-white"
          >
            회원관리 (모임장 · 운영진 전용)
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            회원 성별·급수·연령대 변경, 운영진 권한 부여/회수 및 강퇴 처리를 관리합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenNewMemberModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#5a9cf8] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#488be8] sm:text-sm"
        >
          + 신입 회원 추가
        </button>
      </div>

      {/* 회원 요약 통계 카드 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-[#151821] p-3.5">
          <div className="text-xs text-zinc-400">전체 회원</div>
          <div className="mt-1 text-xl font-bold text-white">
            {stats.total}명
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
          <div className="text-xs text-amber-300">모임장 · 운영진</div>
          <div className="mt-1 text-xl font-bold text-amber-200">
            {stats.staffCount}명
          </div>
        </div>
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5">
          <div className="text-xs text-sky-300">남성 회원</div>
          <div className="mt-1 text-xl font-bold text-sky-200">
            {stats.maleCount}명
          </div>
        </div>
        <div className="rounded-xl border border-pink-500/30 bg-pink-500/10 p-3.5">
          <div className="text-xs text-pink-300">여성 회원</div>
          <div className="mt-1 text-xl font-bold text-pink-200">
            {stats.femaleCount}명
          </div>
        </div>
      </div>

      {/* 검색 및 성별/급수 필터 바 */}
      <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-[#151821] p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <search className="w-full sm:max-w-xs">
          <label htmlFor="admin-member-search" className="sr-only">
            관리할 회원 검색
          </label>
          <input
            id="admin-member-search"
            type="search"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="이름 또는 소모임 닉네임 검색..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-[#5a9cf8]"
          />
        </search>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="정렬 기준"
            value={sortOption}
            onChange={(e) =>
              setSortOption(e.target.value as ManagementSortOption)
            }
            className="rounded-lg border border-[#5a9cf8]/50 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 outline-none focus:border-[#5a9cf8]"
          >
            <option value="ROLE_THEN_LATEST">
              모임장 · 운영진 · 최근가입자순
            </option>
            <option value="LATEST_ONLY">전체 최근가입자순</option>
            <option value="NAME_ASC">이름 가나다순</option>
          </select>

          <select
            aria-label="성별 필터"
            value={genderFilter}
            onChange={(e) =>
              setGenderFilter(e.target.value as "ALL" | Gender)
            }
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none"
          >
            <option value="ALL">전체 성별</option>
            <option value="MALE">남성만</option>
            <option value="FEMALE">여성만</option>
          </select>

          <select
            aria-label="급수 필터"
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value as "ALL" | Grade)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 outline-none"
          >
            <option value="ALL">전체 급수</option>
            {ALL_GRADES.map((g) => (
              <option key={g} value={g}>
                {g}조
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 회원 관리 테이블/리스트 */}
      <ul className="space-y-2.5">
        {filteredMembers.map((member) => {
          const isLeader = member.role === "LEADER";
          const isStaff = member.role === "ADMIN";
          const isFemale = member.gender === "FEMALE";

          return (
            <li
              key={member.id}
              className={`flex flex-col justify-between gap-3 rounded-xl border p-3.5 transition sm:flex-row sm:items-center ${
                isFemale
                  ? "border-pink-400/35 bg-pink-500/12"
                  : "border-sky-400/30 bg-sky-500/10"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  style={{ background: member.avatarGradient }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base text-white"
                >
                  <span aria-hidden="true">{member.avatarEmoji}</span>
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {member.name}
                    </span>
                    {member.nickname !== member.name && (
                      <span className="text-xs text-zinc-300">
                        ({member.nickname})
                      </span>
                    )}
                    {(isLeader || isStaff) && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          isLeader
                            ? "bg-amber-400/20 text-amber-300"
                            : "bg-rose-400/20 text-rose-300"
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
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    가입일: {member.joinedAt}
                  </div>
                </div>
              </div>

              {/* 우측: 성별·급수·연령대 즉시 변경 & 운영진 부여/회수 & 강퇴 */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`${member.name} 성별 변경`}
                  value={member.gender}
                  onChange={(e) =>
                    onUpdateMemberInfo(member.id, {
                      gender: e.target.value as Gender,
                    })
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-semibold text-zinc-200 outline-none"
                >
                  <option value="MALE">남성</option>
                  <option value="FEMALE">여성</option>
                </select>

                <select
                  aria-label={`${member.name} 급수 변경`}
                  value={member.grade}
                  onChange={(e) =>
                    onUpdateMemberInfo(member.id, {
                      grade: e.target.value as Grade,
                    })
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-semibold text-zinc-200 outline-none"
                >
                  {ALL_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}조
                    </option>
                  ))}
                </select>

                <select
                  aria-label={`${member.name} 연령대 변경`}
                  value={member.ageGroup}
                  onChange={(e) =>
                    onUpdateMemberInfo(member.id, {
                      ageGroup: e.target.value as AgeGroup,
                    })
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-semibold text-zinc-200 outline-none"
                >
                  {ALL_AGE_GROUPS.map((ag) => (
                    <option key={ag.value} value={ag.value}>
                      {ag.label}
                    </option>
                  ))}
                </select>

                {!isLeader && (
                  <>
                    {isStaff ? (
                      <button
                        type="button"
                        onClick={() => onToggleStaffRole(member.id, "MEMBER")}
                        className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-200 transition hover:bg-amber-500/30"
                      >
                        운영진 회수
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggleStaffRole(member.id, "ADMIN")}
                        className="rounded-lg border border-amber-400/40 bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-200 transition hover:bg-amber-500/35"
                      >
                        + 운영진 부여
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onKickMember(member.id, member.name)}
                      className="rounded-lg border border-red-500/40 bg-red-500/20 px-2.5 py-1 text-xs font-bold text-red-200 transition hover:bg-red-500/35"
                    >
                      강퇴
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export const MemberManagementSection = React.memo(
  MemberManagementSectionComponent
);
