"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { GenderBadge } from "@/components/common/GenderBadge";
import { Modal } from "@/components/common/Modal";
import type { MeetupScheduleDto, MemberDto } from "@/types/home";

interface MeetupScheduleSectionProps {
  meetups: MeetupScheduleDto[];
  members: MemberDto[];
  isAdmin: boolean;
  onAddMeetup: (newMeetup: Omit<MeetupScheduleDto, "id">) => void;
  onUpdateMeetup: (
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
  ) => void;
  onToggleJoin: (meetupId: number) => void;
  onToggleMemberParticipation: (meetupId: number, memberId: number) => void;
  onRemoveGuestParticipation?: (meetupId: number, guestId: number) => void;
  onStartMatchSession: (meetup: MeetupScheduleDto) => void;
  onDeleteMeetup: (meetupId: number) => void;
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatBadgeDayFromDate(isoDate: string): {
  badgeDay: string;
  fullDateWithDay: string;
} {
  if (!isoDate) {
    return { badgeDay: "정모", fullDateWithDay: "" };
  }
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) {
    return { badgeDay: isoDate, fullDateWithDay: isoDate };
  }
  const dateObj = new Date(y, m - 1, d);
  const dayName = WEEKDAY_KO[dateObj.getDay()];
  return {
    badgeDay: `${m}/${d}(${dayName})`,
    fullDateWithDay: `${isoDate}(${dayName})`,
  };
}

const MeetupScheduleSectionComponent: React.FC<MeetupScheduleSectionProps> = ({
  meetups,
  members,
  isAdmin,
  onAddMeetup,
  onUpdateMeetup,
  onToggleJoin,
  onToggleMemberParticipation,
  onRemoveGuestParticipation,
  onStartMatchSession,
  onDeleteMeetup,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMeetupId, setEditingMeetupId] = useState<number | null>(null);
  const [viewingParticipantsMeetupId, setViewingParticipantsMeetupId] =
    useState<number | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const memberMap = useMemo(() => {
    const map = new Map<number, MemberDto>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  const [form, setForm] = useState({
    title: "",
    selectedDate: "2026-11-18",
    badgeTime: "오후 7:00",
    location: "석곶체육공원",
    feeText: "입장료 무료 지정셔틀콕2개",
    maxParticipants: 16,
    availableCourtCount: 6,
    plannedCourts: [1, 2, 3, 4] as number[],
    thumbnailTheme: "gymWindow" as "gymWindow" | "nightCourt",
  });

  // 새 정모 일정 만들기 모달 열기
  const handleOpenCreateModal = useCallback(() => {
    setEditingMeetupId(null);
    setForm({
      title: "",
      selectedDate: "2026-11-18",
      badgeTime: "오후 7:00",
      location: "석곶체육공원",
      feeText: "입장료 무료 지정셔틀콕2개",
      maxParticipants: 16,
      availableCourtCount: 6,
      plannedCourts: [1, 2, 3, 4],
      thumbnailTheme: "gymWindow",
    });
    setIsModalOpen(true);
  }, []);

  // 기존 정모 일정 수정 모달 열기 (기존 데이터 프리필)
  const handleOpenEditModal = useCallback((meetup: MeetupScheduleDto) => {
    setEditingMeetupId(meetup.id);
    setForm({
      title: meetup.title,
      selectedDate: meetup.selectedDate || "2026-11-18",
      badgeTime: meetup.badgeTime || "오후 7:00",
      location: meetup.location || "석곶체육공원",
      feeText: meetup.feeText || "입장료 무료 지정셔틀콕2개",
      maxParticipants: meetup.maxParticipants || 16,
      availableCourtCount: meetup.availableCourtCount || 6,
      plannedCourts:
        meetup.plannedCourts && meetup.plannedCourts.length > 0
          ? [...meetup.plannedCourts]
          : [1, 2, 3, 4],
      thumbnailTheme: meetup.thumbnailTheme || "gymWindow",
    });
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingMeetupId(null);
  }, []);

  const handleAvailableCourtCountChange = (nextCount: number) => {
    const clamped = Math.max(1, Math.min(16, nextCount));
    setForm((prev) => ({
      ...prev,
      availableCourtCount: clamped,
      plannedCourts: prev.plannedCourts.filter((c) => c <= clamped),
    }));
  };

  const handleTogglePlannedCourt = (courtNumber: number) => {
    setForm((prev) => {
      const exists = prev.plannedCourts.includes(courtNumber);
      const next = exists
        ? prev.plannedCourts.filter((c) => c !== courtNumber)
        : [...prev.plannedCourts, courtNumber].sort((a, b) => a - b);
      return {
        ...prev,
        plannedCourts: next,
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    const { badgeDay, fullDateWithDay } = formatBadgeDayFromDate(
      form.selectedDate
    );
    const timeText = form.badgeTime.trim() || "오후 7:00";
    const dateTimeText = `${fullDateWithDay} ${timeText}`.trim();
    const validPlannedCourts =
      form.plannedCourts.length > 0 ? form.plannedCourts : [1];

    if (editingMeetupId !== null) {
      onUpdateMeetup(editingMeetupId, {
        title: form.title.trim(),
        selectedDate: form.selectedDate,
        badgeDay,
        badgeTime: timeText,
        dateTimeText,
        location: form.location.trim() || "석곶체육공원",
        feeText: form.feeText.trim() || "입장료 무료 지정셔틀콕2개",
        maxParticipants: Number(form.maxParticipants) || 16,
        availableCourtCount: form.availableCourtCount,
        plannedCourts: validPlannedCourts,
        thumbnailTheme: form.thumbnailTheme,
      });
    } else {
      onAddMeetup({
        title: form.title.trim(),
        selectedDate: form.selectedDate,
        badgeDay,
        badgeTime: timeText,
        dateTimeText,
        location: form.location.trim() || "석곶체육공원",
        feeText: form.feeText.trim() || "입장료 무료 지정셔틀콕2개",
        currentParticipants: 1,
        maxParticipants: Number(form.maxParticipants) || 16,
        participantIds: [3],
        availableCourtCount: form.availableCourtCount,
        plannedCourts: validPlannedCourts,
        participantAvatars: [
          "linear-gradient(135deg, #4b3f72 0%, #1f2041 100%)",
        ],
        thumbnailTheme: form.thumbnailTheme,
        isJoined: true,
      });
    }

    setIsModalOpen(false);
    setEditingMeetupId(null);
  };

  const previewDateInfo = formatBadgeDayFromDate(form.selectedDate);

  const viewingMeetup = useMemo(
    () => meetups.find((m) => m.id === viewingParticipantsMeetupId) ?? null,
    [meetups, viewingParticipantsMeetupId]
  );

  const viewingParticipantMembers = useMemo(() => {
    if (!viewingMeetup) return [];
    const ids = viewingMeetup.participantIds || [];
    return ids
      .map((id) => memberMap.get(id))
      .filter((m): m is MemberDto => m !== undefined);
  }, [viewingMeetup, memberMap]);

  const viewingGuests = useMemo(
    () => viewingMeetup?.guests || [],
    [viewingMeetup]
  );

  const viewingTotalParticipantCount =
    viewingParticipantMembers.length + viewingGuests.length;

  const viewingNonParticipantMembers = useMemo(() => {
    if (!viewingMeetup) return [];
    const joinedSet = new Set(viewingMeetup.participantIds || []);
    const keyword = participantSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (joinedSet.has(m.id)) return false;
      if (!keyword) return true;
      return (
        m.name.toLowerCase().includes(keyword) ||
        m.nickname.toLowerCase().includes(keyword)
      );
    });
  }, [viewingMeetup, members, participantSearch]);

  return (
    <section aria-labelledby="meetup-schedule-heading" className="mb-12">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2
          id="meetup-schedule-heading"
          className="text-[18px] font-bold tracking-tight text-zinc-100"
        >
          정모 일정 {meetups.length}
        </h2>

        {isAdmin && (
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5a9cf8] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#488be8] sm:text-sm"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            정모 일정 만들기
          </button>
        )}
      </div>

      <ul className="space-y-3.5">
        {meetups.map((meetup) => {
          const participantList = (meetup.participantIds || [])
            .map((id) => memberMap.get(id))
            .filter((m): m is MemberDto => m !== undefined);

          const guestCount = meetup.guests?.length || 0;
          const currentCount = participantList.length + guestCount;
          const isFull = currentCount >= meetup.maxParticipants;

          return (
            <li
              key={meetup.id}
              className="group flex items-start gap-3 rounded-xl border border-zinc-800/80 bg-[#151821] p-3 transition hover:border-zinc-700 hover:bg-[#191d28] sm:gap-4 sm:p-3.5"
            >
              {/* 좌측 썸네일 배너 */}
              <div className="relative h-[80px] w-[62px] shrink-0 overflow-hidden rounded-lg border border-zinc-700/70 select-none sm:h-[94px] sm:w-[74px]">
                {meetup.thumbnailTheme === "gymWindow" ? (
                  <div className="flex h-full w-full flex-col justify-between bg-[#c9cbc3]">
                    <div className="grid h-6 grid-cols-2 gap-1 px-1.5 pt-1.5">
                      <div className="rounded-[2px] bg-[#eef0ea] shadow-inner" />
                      <div className="rounded-[2px] bg-[#eef0ea] shadow-inner" />
                    </div>
                    <div className="grid h-7 grid-cols-4 gap-0.5 bg-[#2a2321] p-1">
                      <div className="bg-[#594b45]" />
                      <div className="bg-[#73635b]" />
                      <div className="bg-[#594b45]" />
                      <div className="bg-[#433834]" />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col justify-between bg-gradient-to-b from-[#6b829e] via-[#314159] to-[#1e2836]">
                    <div className="h-full w-full opacity-35 [background-image:linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:12px_100%]" />
                  </div>
                )}

                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/65 py-1.5 text-center leading-tight text-white">
                  <div className="text-[12px] font-bold tracking-tight">
                    {meetup.badgeDay}
                  </div>
                  <div className="mt-0.5 text-[11px] font-medium text-zinc-100">
                    {meetup.badgeTime}
                  </div>
                </div>
              </div>

              {/* 우측 정모 상세 정보 */}
              <div className="min-w-0 flex-1 overflow-hidden pt-0.5">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <h3 className="min-w-0 break-words text-[15px] font-bold text-zinc-100">
                      {meetup.title}
                    </h3>

                    <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
                      <button
                        type="button"
                        onClick={() => onStartMatchSession(meetup)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-500/90 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500"
                      >
                        경기 진행
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleJoin(meetup.id)}
                        className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${meetup.isJoined
                            ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40 hover:bg-blue-500/30"
                            : isFull
                              ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                              : "border border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-700"
                          }`}
                      >
                        {meetup.isJoined
                          ? "참가중 (취소)"
                          : isFull
                            ? "마감"
                            : "참가"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setParticipantSearch("");
                          setViewingParticipantsMeetupId(meetup.id);
                        }}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition hover:border-[#5a9cf8] hover:text-white"
                      >
                        👥 참가자 현황 ({currentCount}/{meetup.maxParticipants})
                      </button>

                      {isAdmin && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(meetup)}
                            className="whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-800/90 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700 hover:text-white"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteMeetup(meetup.id)}
                            aria-label={`${meetup.title} 정모 삭제`}
                            className="rounded-md p-1 text-zinc-500 transition hover:bg-red-500/15 hover:text-red-400"
                            title="정모 삭제"
                          >
                            <svg
                              aria-hidden="true"
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M3 6h18M8 6V4h8v2m-9 0v13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-1 space-y-0.5 text-[13px] text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm1 10.414V7a1 1 0 0 0-2 0v6a1 1 0 0 0 .293.707l3 3a1 1 0 0 0 1.414-1.414Z" />
                    </svg>
                    <span>{meetup.dateTimeText}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <svg
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z" />
                    </svg>
                    <span>{meetup.location}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-xs text-emerald-300/90">
                      전체 {meetup.availableCourtCount}코트 중{" "}
                      {meetup.plannedCourts.map((n) => `${n}번`).join(", ")}{" "}
                      사용예정
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[11px] font-bold text-zinc-500"
                    >
                      ₩
                    </span>
                    <span>{meetup.feeText}</span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 참가자 현황 상세 모달 (PC에서도 넓고 쾌적하게 보이도록 size="4xl" 적용) */}
      <Modal
        isOpen={viewingMeetup !== null}
        onClose={() => setViewingParticipantsMeetupId(null)}
        size="4xl"
        title={
          viewingMeetup
            ? `${viewingMeetup.title} · 참가자 현황 (${viewingTotalParticipantCount}/${viewingMeetup.maxParticipants}명)`
            : "참가자 현황"
        }
      >
        {viewingMeetup && (
          <div className="space-y-5 text-sm">
            {/* 남/여 참가 인원 요약 (회원 + 게스트 합산) */}
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center">
              <div>
                <div className="text-xs font-medium text-zinc-400">
                  총 참가 인원
                </div>
                <div className="mt-1 text-lg font-bold text-white">
                  {viewingTotalParticipantCount}/{viewingMeetup.maxParticipants}명
                  {viewingGuests.length > 0 && (
                    <span className="ml-1.5 text-xs font-semibold text-amber-300">
                      (게스트 {viewingGuests.length}명)
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-sky-300">
                  남성 참가자
                </div>
                <div className="mt-1 text-lg font-bold text-sky-300">
                  {viewingParticipantMembers.filter((m) => m.gender === "MALE")
                    .length +
                    viewingGuests.filter((g) => g.gender === "MALE").length}
                  명
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-pink-300">
                  여성 참가자
                </div>
                <div className="mt-1 text-lg font-bold text-pink-300">
                  {viewingParticipantMembers.filter(
                    (m) => m.gender === "FEMALE"
                  ).length +
                    viewingGuests.filter((g) => g.gender === "FEMALE").length}
                  명
                </div>
              </div>
            </div>

            <div
              className={`grid grid-cols-1 gap-5 ${isAdmin ? "lg:grid-cols-2" : ""
                }`}
            >
              {/* 현재 참가 신청한 멤버 + 게스트 리스트 */}
              <div className="flex flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                <h3 className="mb-3 text-sm font-bold text-zinc-100">
                  현재 참가 신청 명단 ({viewingTotalParticipantCount}명)
                </h3>

                {viewingTotalParticipantCount === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
                    아직 참가 신청한 멤버가 없습니다.
                  </div>
                ) : (
                  <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {viewingParticipantMembers.map((m, idx) => {
                      const isFemale = m.gender === "FEMALE";
                      return (
                        <li
                          key={`member-${m.id}`}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${isFemale
                              ? "border-pink-400/35 bg-pink-500/15"
                              : "border-sky-400/35 bg-sky-500/15"
                            }`}
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-zinc-400">
                              {idx + 1}.
                            </span>
                            <span className="font-bold text-white">
                              {m.name}
                            </span>
                            {m.nickname !== m.name && (
                              <span className="text-xs text-zinc-300">
                                ({m.nickname})
                              </span>
                            )}
                            <GenderBadge
                              gender={m.gender}
                              grade={m.grade}
                              ageGroup={m.ageGroup}
                            />
                          </div>

                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() =>
                                onToggleMemberParticipation(
                                  viewingMeetup.id,
                                  m.id
                                )
                              }
                              className="shrink-0 rounded-md bg-rose-500/25 px-2.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/40"
                            >
                              참가 취소
                            </button>
                          )}
                        </li>
                      );
                    })}

                    {viewingGuests.map((g, gIdx) => {
                      const isFemale = g.gender === "FEMALE";
                      return (
                        <li
                          key={`guest-${g.id}`}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${isFemale
                              ? "border-pink-400/35 bg-pink-500/15"
                              : "border-sky-400/35 bg-sky-500/15"
                            }`}
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-zinc-400">
                              {viewingParticipantMembers.length + gIdx + 1}.
                            </span>
                            <span className="rounded bg-amber-400/25 px-1.5 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/40">
                              게스트
                            </span>
                            <span className="font-bold text-white">
                              {g.name}
                            </span>
                            <GenderBadge
                              gender={g.gender}
                              grade={g.grade}
                              ageGroup={g.ageGroup}
                            />
                          </div>

                          {isAdmin && onRemoveGuestParticipation && (
                            <button
                              type="button"
                              onClick={() =>
                                onRemoveGuestParticipation(
                                  viewingMeetup.id,
                                  g.id
                                )
                              }
                              className="shrink-0 rounded-md bg-rose-500/25 px-2.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/40"
                            >
                              참가 취소
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* 모임장 · 운영진 전용: 모임 멤버 중 추가 참가 등록 (일반회원에게는 미노출) */}
              {isAdmin && (
                <div className="flex flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-zinc-100">
                      모임 멤버 참가 추가 (운영진 전용)
                    </h3>
                    <input
                      type="search"
                      value={participantSearch}
                      onChange={(e) => setParticipantSearch(e.target.value)}
                      placeholder="멤버 이름 검색..."
                      className="w-48 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-[#5a9cf8]"
                    />
                  </div>

                  <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {viewingNonParticipantMembers.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3.5 py-2 text-sm"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-bold text-zinc-100">
                            {m.name}
                          </span>
                          <GenderBadge
                            gender={m.gender}
                            grade={m.grade}
                            ageGroup={m.ageGroup}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={
                            viewingTotalParticipantCount >=
                            viewingMeetup.maxParticipants
                          }
                          onClick={() =>
                            onToggleMemberParticipation(viewingMeetup.id, m.id)
                          }
                          className="shrink-0 rounded-md bg-[#5a9cf8] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#488be8] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          + 참가 등록
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 새 정모 일정 만들기 / 기존 정모 일정 수정 모달 */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={
          editingMeetupId !== null ? "정모 일정 수정" : "새 정모 일정 만들기"
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          <div>
            <label
              htmlFor="meetup-title-input"
              className="mb-1 block font-semibold text-zinc-300"
            >
              정모 제목
            </label>
            <input
              id="meetup-title-input"
              name="title"
              type="text"
              required
              placeholder="예: 토요일 주말 정모(게스트 남 1, 여 1)"
              value={form.title}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, title: e.target.value }))
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="meetup-date-input"
                className="mb-1 flex items-center justify-between font-semibold text-zinc-300"
              >
                <span>날짜/요일 선택</span>
                <span className="text-xs font-bold text-[#5a9cf8]">
                  {previewDateInfo.badgeDay}
                </span>
              </label>
              <div
                onClick={() => dateInputRef.current?.showPicker?.()}
                className="relative cursor-pointer"
              >
                <input
                  ref={dateInputRef}
                  id="meetup-date-input"
                  name="selectedDate"
                  type="date"
                  required
                  value={form.selectedDate}
                  onClick={(e) => e.currentTarget.showPicker?.()}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      selectedDate: e.target.value,
                    }))
                  }
                  className="w-full cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="meetup-time-input"
                className="mb-1 block font-semibold text-zinc-300"
              >
                시간 표시
              </label>
              <input
                id="meetup-time-input"
                name="badgeTime"
                type="text"
                placeholder="예: 오후 7:00"
                value={form.badgeTime}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, badgeTime: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
              />
            </div>
          </div>

          {/* 사용가능코트 / 사용예정코트 설정 영역 */}
          <fieldset className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
            <legend className="px-1 text-xs font-bold text-zinc-300">
              코트 운영 설정 (사용가능코트 / 사용예정코트)
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="available-court-count"
                  className="mb-1 block text-xs font-semibold text-zinc-300"
                >
                  사용가능코트 (체육관 전체)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="available-court-count"
                    name="availableCourtCount"
                    type="number"
                    min={1}
                    max={16}
                    value={form.availableCourtCount}
                    onChange={(e) =>
                      handleAvailableCourtCountChange(Number(e.target.value))
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-100 outline-none focus:border-[#5a9cf8]"
                  />
                  <span className="shrink-0 text-xs text-zinc-400">코트</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="planned-court-count"
                  className="mb-1 block text-xs font-semibold text-emerald-300"
                >
                  사용예정코트 수 (초기 활성)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="planned-court-count"
                    name="plannedCourtCount"
                    type="number"
                    min={1}
                    max={form.availableCourtCount}
                    value={form.plannedCourts.length}
                    onChange={(e) => {
                      const count = Math.max(
                        1,
                        Math.min(
                          form.availableCourtCount,
                          Number(e.target.value) || 1
                        )
                      );
                      setForm((prev) => ({
                        ...prev,
                        plannedCourts: Array.from(
                          { length: count },
                          (_, i) => i + 1
                        ),
                      }));
                    }}
                    className="w-full rounded-lg border border-emerald-500/40 bg-zinc-900 px-3 py-1.5 text-emerald-200 outline-none focus:border-emerald-400"
                  />
                  <span className="shrink-0 text-xs text-zinc-400">코트</span>
                </div>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-300">
                  사용예정코트 번호 선택 (클릭하여 활성/비활성 지정)
                </span>
                <span className="text-[11px] text-emerald-300">
                  선택된 코트만 경기진행 시 먼저 활성화됩니다
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {Array.from(
                  { length: form.availableCourtCount },
                  (_, idx) => idx + 1
                ).map((courtNum) => {
                  const isPlanned = form.plannedCourts.includes(courtNum);
                  return (
                    <button
                      key={courtNum}
                      type="button"
                      onClick={() => handleTogglePlannedCourt(courtNum)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${isPlanned
                          ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
                          : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                        }`}
                    >
                      {courtNum}번 {isPlanned ? "사용예정" : "미사용"}
                    </button>
                  );
                })}
              </div>
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="meetup-location-input"
              className="mb-1 block font-semibold text-zinc-300"
            >
              장소 (체육관)
            </label>
            <input
              id="meetup-location-input"
              name="location"
              type="text"
              placeholder="예: 석곶체육공원"
              value={form.location}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, location: e.target.value }))
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label
                htmlFor="meetup-fee-input"
                className="mb-1 block font-semibold text-zinc-300"
              >
                참가비 / 지정콕 안내
              </label>
              <input
                id="meetup-fee-input"
                name="feeText"
                type="text"
                placeholder="예: 입장료 무료 지정셔틀콕2개"
                value={form.feeText}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, feeText: e.target.value }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
              />
            </div>

            <div>
              <label
                htmlFor="meetup-max-input"
                className="mb-1 block font-semibold text-zinc-300"
              >
                최대 정원
              </label>
              <input
                id="meetup-max-input"
                name="maxParticipants"
                type="number"
                min={2}
                max={100}
                value={form.maxParticipants}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    maxParticipants: Number(e.target.value),
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none transition focus:border-[#5a9cf8]"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#5a9cf8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#488be8]"
            >
              {editingMeetupId !== null ? "수정 저장" : "정모 등록"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
};

export const MeetupScheduleSection = React.memo(MeetupScheduleSectionComponent);
