export type MemberRole = "LEADER" | "ADMIN" | "MEMBER";
export type Gender = "MALE" | "FEMALE";
export type Grade = "S" | "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type InjuryLevel = "NONE" | "MILD" | "SEVERE";
export type AgeGroup =
  | "UNDER_10"
  | "20S"
  | "30S"
  | "40S"
  | "50S"
  | "60S"
  | "OVER_70";

export type MemberSortMode = "ADMIN_THEN_LATEST" | "LATEST_FIRST";

export interface MeetupGuestDto {
  id: number;
  name: string;
  gender: Gender;
  grade: Grade;
  ageGroup: AgeGroup;
}

export interface MeetupScheduleDto {
  id: number;
  title: string;
  selectedDate?: string; // YYYY-MM-DD
  badgeDay: string;
  badgeTime: string;
  dateTimeText: string;
  location: string;
  feeText: string;
  currentParticipants: number;
  maxParticipants: number;
  participantIds: number[]; // 참가 버튼을 누른 회원 ID 목록
  guests?: MeetupGuestDto[]; // 경기 진행 현황판 등에서 등록된 게스트 목록
  availableCourtCount: number; // 체육관 전체 사용가능코트 수 (예: 6면)
  plannedCourts: number[]; // 사용예정코트 번호 목록 (예: [1, 2, 3, 4])
  participantAvatars: string[];
  thumbnailTheme: "gymWindow" | "nightCourt";
  isJoined?: boolean;
}

export interface MemberDto {
  id: number;
  name: string;
  nickname: string;
  role: MemberRole;
  gender: Gender;
  grade: Grade;
  ageGroup: AgeGroup;
  bio: string;
  joinedAt: string; // YYYY-MM-DD or ISO-8601
  injuryLevel?: InjuryLevel; // 부상 정도 (NONE / MILD -50 / SEVERE -120)
  eloScore?: number; // 실시간 반영되는 순수 ELO 레이팅 점수
  avatarGradient: string;
  avatarEmoji: string;
}

/**
 * 회원별 매칭 선호/기피 설정
 * - sameGenderPartnerId: 남성 회원의 '남복 파트너(1명)' 또는 여성 회원의 '여복 파트너(1명)'
 * - mixedPartnerId: '혼복 파트너(1명)' -> 총 2명까지만 파트너 지정 가능
 * - avoidMemberIds: 기피 인원 ID 배열 (최대 3명까지 지정 가능)
 */
export interface MemberPreferenceDto {
  memberId: number;
  sameGenderPartnerId?: number | null;
  mixedPartnerId?: number | null;
  avoidMemberIds: number[];
}
