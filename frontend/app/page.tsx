"use client";

import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GenderBadge } from "@/components/common/GenderBadge";
import { Modal } from "@/components/common/Modal";
import { MeetupScheduleSection } from "@/components/features/home/MeetupScheduleSection";
import { MemberListSection } from "@/components/features/home/MemberListSection";
import { MemberManagementSection } from "@/components/features/home/MemberManagementSection";
import { ProfileSection } from "@/components/features/home/ProfileSection";
import {
  GRADE_BASE_ELO,
  getAvatarGradientByGender,
  INITIAL_MEETUPS,
  INITIAL_MEMBERS,
} from "@/data/membersData";
import type {
  AgeGroup,
  Gender,
  Grade,
  MeetupScheduleDto,
  MemberDto,
} from "@/types/home";

type MainTabType = "홈" | "랭킹" | "회원관리" | "프로필";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MainTabType>("홈");
  const [isAdmin, setIsAdmin] = useState(true);
  const [meetups, setMeetups] = useState<MeetupScheduleDto[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("dailyminton_meetups");
        if (saved) {
          const parsed = JSON.parse(saved) as MeetupScheduleDto[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // ignore
      }
    }
    return INITIAL_MEETUPS;
  });
  const [members, setMembers] = useState<MemberDto[]>(INITIAL_MEMBERS);

  // 신입 회원 추가 모달 상태
  const [isNewMemberModalOpen, setIsNewMemberModalOpen] = useState(false);
  const joinDateInputRef = useRef<HTMLInputElement | null>(null);
  const [newMemberForm, setNewMemberForm] = useState({
    name: "",
    nickname: "",
    gender: "MALE" as Gender,
    grade: "F" as Grade,
    ageGroup: "30S" as AgeGroup,
    joinedAt: "2026-11-18",
    bio: "안녕하세요! 데일리민턴 신입 회원입니다.",
  });

  const updateMeetupsWithStorage = useCallback(
    (updater: (prev: MeetupScheduleDto[]) => MeetupScheduleDto[]) => {
      setMeetups((prev) => {
        const next = updater(prev);
        try {
          sessionStorage.setItem("dailyminton_meetups", JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  // 경기 진행 현황판 등에서 변경된 정모 참가자(정식회원 + 게스트) 및 최종 ELO 점수를 홈 화면 복귀 시 즉시 동기화
  useEffect(() => {
    const syncFromStorage = () => {
      try {
        const saved = sessionStorage.getItem("dailyminton_meetups");
        if (saved) {
          const parsed = JSON.parse(saved) as MeetupScheduleDto[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMeetups(parsed);
          }
        }
      } catch {
        // ignore
      }

      try {
        const rawElo = localStorage.getItem("dailyminton_member_elos");
        if (rawElo) {
          const eloMap = JSON.parse(rawElo) as Record<string, number>;
          setMembers((prev) =>
            prev.map((m) => {
              const savedElo = eloMap[String(m.id)];
              return typeof savedElo === "number"
                ? { ...m, eloScore: savedElo }
                : m;
            })
          );
        }
      } catch {
        // ignore
      }
    };
    syncFromStorage();
    window.addEventListener("focus", syncFromStorage);
    window.addEventListener("pageshow", syncFromStorage);
    return () => {
      window.removeEventListener("focus", syncFromStorage);
      window.removeEventListener("pageshow", syncFromStorage);
    };
  }, []);

  // PostgreSQL(dailyminton DB) 실시간 회원 정보 동기화
  useEffect(() => {
    let isMounted = true;
    fetch("/api/members", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MemberDto[] | null) => {
        if (isMounted && Array.isArray(data) && data.length > 0) {
          let eloMap: Record<string, number> = {};
          try {
            const rawElo = localStorage.getItem("dailyminton_member_elos");
            if (rawElo) {
              eloMap = JSON.parse(rawElo) as Record<string, number>;
            }
          } catch {
            // ignore
          }
          setMembers(
            data.map((m) => ({
              ...m,
              eloScore:
                eloMap[String(m.id)] ??
                m.eloScore ??
                GRADE_BASE_ELO[m.grade],
            }))
          );
        }
      })
      .catch(() => {
        // DB 연결 실패 시 기본 시드 유지
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleAddMeetup = useCallback(
    (newMeetup: Omit<MeetupScheduleDto, "id">) => {
      updateMeetupsWithStorage((prev) => [
        ...prev,
        {
          ...newMeetup,
          id: Date.now(),
        },
      ]);
    },
    [updateMeetupsWithStorage]
  );

  const handleUpdateMeetup = useCallback(
    (
      meetupId: number,
      updated: {
        title: string;
        selectedDate: string;
        badgeDay: string;
        badgeTime: string;
        dateTimeText: string;
        location: string;
        feeText: string;
        maxParticipants: number;
        availableCourtCount: number;
        plannedCourts: number[];
        thumbnailTheme: "gymWindow" | "nightCourt";
      }
    ) => {
      updateMeetupsWithStorage((prev) =>
        prev.map((m) => {
          if (m.id !== meetupId) return m;
          const nextMeetup = { ...m, ...updated };
          try {
            sessionStorage.setItem(
              `dailyminton_meetup_${meetupId}`,
              JSON.stringify(nextMeetup)
            );
          } catch {
            // ignore
          }
          return nextMeetup;
        })
      );
    },
    [updateMeetupsWithStorage]
  );

  const handleToggleJoin = useCallback(
    (meetupId: number) => {
      updateMeetupsWithStorage((prev) =>
        prev.map((m) => {
          if (m.id !== meetupId) return m;
          const currentIds = m.participantIds || [];
          const guestCount = m.guests?.length || 0;
          const myMemberId = 3; // 기본 로그인 사용자(한태호)
          const alreadyIn = currentIds.includes(myMemberId);

          let nextMeetup: MeetupScheduleDto;
          if (m.isJoined || alreadyIn) {
            const nextIds = currentIds.filter((id) => id !== myMemberId);
            nextMeetup = {
              ...m,
              isJoined: false,
              participantIds: nextIds,
              currentParticipants: nextIds.length + guestCount,
              participantAvatars: m.participantAvatars.slice(0, -1),
            };
          } else {
            if (currentIds.length + guestCount >= m.maxParticipants) return m;
            const nextIds = [...currentIds, myMemberId];
            nextMeetup = {
              ...m,
              isJoined: true,
              participantIds: nextIds,
              currentParticipants: nextIds.length + guestCount,
              participantAvatars: [
                ...m.participantAvatars,
                "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
              ],
            };
          }
          try {
            sessionStorage.setItem(
              `dailyminton_meetup_${meetupId}`,
              JSON.stringify(nextMeetup)
            );
          } catch {
            // ignore
          }
          return nextMeetup;
        })
      );
    },
    [updateMeetupsWithStorage]
  );

  // 정모 참가자 현황 모달에서 특정 회원의 참가 신청/취소 토글
  const handleToggleMemberParticipation = useCallback(
    (meetupId: number, memberId: number) => {
      updateMeetupsWithStorage((prev) =>
        prev.map((m) => {
          if (m.id !== meetupId) return m;
          const currentIds = m.participantIds || [];
          const guestCount = m.guests?.length || 0;
          const exists = currentIds.includes(memberId);
          if (!exists && currentIds.length + guestCount >= m.maxParticipants) {
            return m;
          }

          const nextIds = exists
            ? currentIds.filter((id) => id !== memberId)
            : [...currentIds, memberId];

          const nextMeetup: MeetupScheduleDto = {
            ...m,
            participantIds: nextIds,
            currentParticipants: nextIds.length + guestCount,
          };
          try {
            sessionStorage.setItem(
              `dailyminton_meetup_${meetupId}`,
              JSON.stringify(nextMeetup)
            );
          } catch {
            // ignore
          }
          return nextMeetup;
        })
      );
    },
    [updateMeetupsWithStorage]
  );

  // 정모 참가자 현황 모달에서 게스트 참가 취소
  const handleRemoveGuestParticipation = useCallback(
    (meetupId: number, guestId: number) => {
      updateMeetupsWithStorage((prev) =>
        prev.map((m) => {
          if (m.id !== meetupId) return m;
          const nextGuests = (m.guests || []).filter((g) => g.id !== guestId);
          const nextMeetup: MeetupScheduleDto = {
            ...m,
            guests: nextGuests,
            currentParticipants:
              (m.participantIds?.length || 0) + nextGuests.length,
          };
          try {
            sessionStorage.setItem(
              `dailyminton_meetup_${meetupId}`,
              JSON.stringify(nextMeetup)
            );
          } catch {
            // ignore
          }
          return nextMeetup;
        })
      );
    },
    [updateMeetupsWithStorage]
  );

  const handleStartMatchSession = useCallback(
    (meetup: MeetupScheduleDto) => {
      try {
        sessionStorage.setItem(
          `dailyminton_meetup_${meetup.id}`,
          JSON.stringify(meetup)
        );
      } catch {
        // ignore
      }
      const query = new URLSearchParams({
        title: meetup.title,
        date: meetup.dateTimeText,
        location: meetup.location,
        fee: meetup.feeText,
        available: String(meetup.availableCourtCount || 6),
        planned: (meetup.plannedCourts || [1, 2, 3, 4]).join(","),
        participants: (meetup.participantIds || []).join(","),
        role: isAdmin ? "admin" : "member",
      });
      router.push(`/session/${meetup.id}?${query.toString()}`);
    },
    [router, isAdmin]
  );

  const handleDeleteMeetup = useCallback(
    (meetupId: number) => {
      updateMeetupsWithStorage((prev) => prev.filter((m) => m.id !== meetupId));
    },
    [updateMeetupsWithStorage]
  );

  // 모임장이 특정 멤버의 운영진 권한을 부여(ADMIN)하거나 회수(MEMBER)
  const handleToggleStaffRole = useCallback(
    (memberId: number, nextRole: "ADMIN" | "MEMBER") => {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? {
                ...m,
                role: nextRole,
                avatarEmoji: nextRole === "ADMIN" ? "🔥" : "🏸",
              }
            : m
        )
      );

      fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role: nextRole }),
      }).catch(() => {
        // ignore
      });
    },
    []
  );

  // 회원관리 또는 프로필 탭에서 회원 성별·급수·연령대·닉네임·인사말 수정 시 UI 및 DB 반영
  const handleUpdateMemberInfo = useCallback(
    (
      memberId: number,
      updates: {
        name?: string;
        nickname?: string;
        gender?: Gender;
        grade?: Grade;
        ageGroup?: AgeGroup;
        bio?: string;
      }
    ) => {
      if (updates.grade) {
        try {
          const rawElo = localStorage.getItem("dailyminton_member_elos");
          const eloMap: Record<string, number> = rawElo
            ? (JSON.parse(rawElo) as Record<string, number>)
            : {};
          eloMap[String(memberId)] = GRADE_BASE_ELO[updates.grade];
          localStorage.setItem(
            "dailyminton_member_elos",
            JSON.stringify(eloMap)
          );
        } catch {
          // ignore
        }
      }

      setMembers((prev) =>
        prev.map((m) => {
          if (m.id !== memberId) return m;
          const nextGender = updates.gender ?? m.gender;
          return {
            ...m,
            ...updates,
            ...(updates.grade
              ? { eloScore: GRADE_BASE_ELO[updates.grade] }
              : {}),
            avatarGradient: getAvatarGradientByGender(nextGender, m.role),
          };
        })
      );

      fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, ...updates }),
      }).catch(() => {
        // ignore
      });
    },
    []
  );

  // 모임장이 특정 멤버를 강퇴 처리
  const handleKickMember = useCallback(
    (memberId: number, memberName: string) => {
      if (!window.confirm(`정말 '${memberName}' 회원을 모임에서 강퇴하시겠습니까?`)) {
        return;
      }

      setMembers((prev) => prev.filter((m) => m.id !== memberId));

      fetch(`/api/members?memberId=${memberId}`, {
        method: "DELETE",
      }).catch(() => {
        // ignore
      });
    },
    []
  );

  // 상단 "+ 신입 회원 추가" 모달 제출 처리
  const handleCreateNewMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newMemberForm.name.trim();
    if (!trimmedName) return;

    const trimmedNickname = newMemberForm.nickname.trim() || trimmedName;
    const tempId = Date.now();

    const optimisticMember: MemberDto = {
      id: tempId,
      name: trimmedName,
      nickname: trimmedNickname,
      role: "MEMBER",
      gender: newMemberForm.gender,
      grade: newMemberForm.grade,
      ageGroup: newMemberForm.ageGroup,
      bio: newMemberForm.bio.trim() || ".",
      joinedAt: newMemberForm.joinedAt || "2026-11-18",
      avatarGradient: getAvatarGradientByGender(newMemberForm.gender, "MEMBER"),
      avatarEmoji: "🏸",
    };

    setMembers((prev) => [optimisticMember, ...prev]);
    setIsNewMemberModalOpen(false);
    setNewMemberForm({
      name: "",
      nickname: "",
      gender: "MALE",
      grade: "F",
      ageGroup: "30S",
      joinedAt: "2026-11-18",
      bio: "안녕하세요! 데일리민턴 신입 회원입니다.",
    });

    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: optimisticMember.name,
          nickname: optimisticMember.nickname,
          gender: optimisticMember.gender,
          grade: optimisticMember.grade,
          ageGroup: optimisticMember.ageGroup,
          joinedAt: optimisticMember.joinedAt,
          bio: optimisticMember.bio,
        }),
      });
      if (res.ok) {
        const result = (await res.json()) as { id?: number };
        if (result.id) {
          setMembers((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, id: result.id! } : m))
          );
        }
      }
    } catch {
      // ignore
    }
  };

  const rankedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const scoreA = (a.eloScore ?? GRADE_BASE_ELO[a.grade]) + 200;
      const scoreB = (b.eloScore ?? GRADE_BASE_ELO[b.grade]) + 200;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [members]);

  const visibleTabs = useMemo<MainTabType[]>(
    () =>
      isAdmin
        ? ["홈", "랭킹", "회원관리", "프로필"]
        : ["홈", "랭킹", "프로필"],
    [isAdmin]
  );

  const handleToggleRoleMode = useCallback(() => {
    setIsAdmin((prev) => {
      const nextIsAdmin = !prev;
      if (!nextIsAdmin && activeTab === "회원관리") {
        setActiveTab("홈");
      }
      return nextIsAdmin;
    });
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-[#0d0f14] text-zinc-100">
      {/* 상단 탭 바 (운영진: 홈/랭킹/회원관리/프로필, 일반회원: 홈/랭킹/프로필) */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-[#0d0f14]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[960px] items-center justify-between gap-2 px-4 sm:px-6">
          <nav aria-label="모임 메뉴">
            <ul className="flex items-center gap-6 sm:gap-8">
              {visibleTabs.map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <li key={tab}>
                    <button
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`relative py-4 text-[15px] transition-colors ${
                        isActive
                          ? "font-bold text-white"
                          : "font-medium text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {tab}
                      {isActive && (
                        <span className="absolute right-0 bottom-0 left-0 h-[2.5px] rounded-full bg-[#5a9cf8]" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            {/* 모임장 및 운영진에게만 신입 회원 추가 버튼 노출 (일반회원에게는 숨김) */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsNewMemberModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-[#5a9cf8] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#488be8]"
              >
                + 신입 회원 추가
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleRoleMode}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                isAdmin
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isAdmin ? "bg-amber-400" : "bg-zinc-500"
                }`}
              />
              {isAdmin ? "운영진 권한" : "일반회원 권한"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[960px] px-4 pt-7 pb-20 sm:px-6">
        <h1 className="sr-only">데일리민턴</h1>

        {activeTab === "홈" && (
          <>
            {/* 1. 정모 일정 섹션 */}
            <MeetupScheduleSection
              meetups={meetups}
              members={members}
              isAdmin={isAdmin}
              onAddMeetup={handleAddMeetup}
              onUpdateMeetup={handleUpdateMeetup}
              onToggleJoin={handleToggleJoin}
              onToggleMemberParticipation={handleToggleMemberParticipation}
              onRemoveGuestParticipation={handleRemoveGuestParticipation}
              onStartMatchSession={handleStartMatchSession}
              onDeleteMeetup={handleDeleteMeetup}
            />

            {/* 2. 모임 멤버 리스트 섹션 (회원 검색 + 운영진 부여/회수 + 강퇴 버튼) */}
            <MemberListSection
              members={members}
              totalCount={members.length}
              isLeaderView={isAdmin}
              onToggleStaffRole={handleToggleStaffRole}
              onKickMember={handleKickMember}
            />
          </>
        )}

        {activeTab === "랭킹" && (
          /* 랭킹 탭 화면 */
          <section aria-labelledby="ranking-heading">
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="ranking-heading"
                className="text-[18px] font-bold tracking-tight text-zinc-100"
              >
                전체 회원 랭킹 ({rankedMembers.length}명)
              </h2>
              <span className="text-xs text-zinc-400">
                기준: 순수 ELO 경기력 점수 + 연령대 가점
              </span>
            </div>

            <ul className="space-y-2.5">
              {rankedMembers.map((member, index) => {
                const eloScore = Math.round(
                  member.eloScore ?? GRADE_BASE_ELO[member.grade]
                );
                const rankingScore = eloScore + 200;
                return (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3.5 rounded-xl border border-zinc-800/70 bg-[#151821] px-4 py-3"
                  >
                    <div className="flex items-center gap-3.5">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          index < 3
                            ? "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/40"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] font-bold text-zinc-100">
                          {member.name}
                        </span>
                        {member.nickname !== member.name && (
                          <span className="text-xs text-zinc-400">
                            ({member.nickname})
                          </span>
                        )}
                        <GenderBadge
                          gender={member.gender}
                          grade={member.grade}
                          ageGroup={member.ageGroup}
                        />
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-bold text-[#5a9cf8]">
                        {rankingScore.toLocaleString()}점
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        ELO {eloScore} + 가점 200
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {activeTab === "회원관리" && isAdmin && (
          <MemberManagementSection
            members={members}
            onOpenNewMemberModal={() => setIsNewMemberModalOpen(true)}
            onToggleStaffRole={handleToggleStaffRole}
            onUpdateMemberInfo={handleUpdateMemberInfo}
            onKickMember={handleKickMember}
          />
        )}

        {activeTab === "프로필" && (
          <ProfileSection
            members={members}
            onUpdateMemberProfile={handleUpdateMemberInfo}
          />
        )}
      </main>

      {/* 신입 회원 추가 모달 */}
      <Modal
        isOpen={isNewMemberModalOpen}
        onClose={() => setIsNewMemberModalOpen(false)}
        title="신입 회원 추가"
      >
        <form onSubmit={handleCreateNewMember} className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="new-member-name"
                className="mb-1 block font-semibold text-zinc-300"
              >
                이름 (실명)
              </label>
              <input
                id="new-member-name"
                name="name"
                type="text"
                required
                placeholder="예: 김민턴"
                value={newMemberForm.name}
                onChange={(e) =>
                  setNewMemberForm((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
              />
            </div>

            <div>
              <label
                htmlFor="new-member-nickname"
                className="mb-1 block font-semibold text-zinc-300"
              >
                소모임 닉네임
              </label>
              <input
                id="new-member-nickname"
                name="nickname"
                type="text"
                placeholder="미입력 시 이름과 동일"
                value={newMemberForm.nickname}
                onChange={(e) =>
                  setNewMemberForm((prev) => ({
                    ...prev,
                    nickname: e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label
                htmlFor="new-member-gender"
                className="mb-1 block font-semibold text-zinc-300"
              >
                성별
              </label>
              <select
                id="new-member-gender"
                name="gender"
                value={newMemberForm.gender}
                onChange={(e) =>
                  setNewMemberForm((prev) => ({
                    ...prev,
                    gender: e.target.value as Gender,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-100 outline-none"
              >
                <option value="MALE">남성</option>
                <option value="FEMALE">여성</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="new-member-grade"
                className="mb-1 block font-semibold text-zinc-300"
              >
                급수 (S~G)
              </label>
              <select
                id="new-member-grade"
                name="grade"
                value={newMemberForm.grade}
                onChange={(e) =>
                  setNewMemberForm((prev) => ({
                    ...prev,
                    grade: e.target.value as Grade,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-100 outline-none"
              >
                {(["S", "A", "B", "C", "D", "E", "F", "G"] as const).map(
                  (g) => (
                    <option key={g} value={g}>
                      {g}조
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="new-member-age"
                className="mb-1 block font-semibold text-zinc-300"
              >
                연령대
              </label>
              <select
                id="new-member-age"
                name="ageGroup"
                value={newMemberForm.ageGroup}
                onChange={(e) =>
                  setNewMemberForm((prev) => ({
                    ...prev,
                    ageGroup: e.target.value as AgeGroup,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-zinc-100 outline-none"
              >
                <option value="UNDER_10">10대 미만</option>
                <option value="20S">20대</option>
                <option value="30S">30대</option>
                <option value="40S">40대</option>
                <option value="50S">50대</option>
                <option value="60S">60대</option>
                <option value="OVER_70">70대 이상</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="new-member-joined-date"
              className="mb-1 block font-semibold text-zinc-300"
            >
              가입일자
            </label>
            <div
              onClick={() => joinDateInputRef.current?.showPicker?.()}
              className="relative cursor-pointer"
            >
              <input
                ref={joinDateInputRef}
                id="new-member-joined-date"
                name="joinedAt"
                type="date"
                required
                value={newMemberForm.joinedAt}
                onClick={(e) => e.currentTarget.showPicker?.()}
                onChange={(e) =>
                  setNewMemberForm((prev) => ({
                    ...prev,
                    joinedAt: e.target.value,
                  }))
                }
                className="w-full cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="new-member-bio"
              className="mb-1 block font-semibold text-zinc-300"
            >
              가입 인사말
            </label>
            <input
              id="new-member-bio"
              name="bio"
              type="text"
              value={newMemberForm.bio}
              onChange={(e) =>
                setNewMemberForm((prev) => ({
                  ...prev,
                  bio: e.target.value,
                }))
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-[#5a9cf8]"
            />
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsNewMemberModalOpen(false)}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#5a9cf8] px-4 py-2 text-xs font-bold text-white hover:bg-[#488be8]"
            >
              신입 회원 등록
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
