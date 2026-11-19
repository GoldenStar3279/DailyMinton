"use client";

import React from "react";
import type { AgeGroup, Gender, Grade } from "@/types/home";

const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  UNDER_10: "10대 미만",
  "20S": "20대",
  "30S": "30대",
  "40S": "40대",
  "50S": "50대",
  "60S": "60대",
  OVER_70: "70대 이상",
};

interface GenderBadgeProps {
  gender: Gender;
  grade: Grade;
  ageGroup: AgeGroup;
}

/**
 * 다크 테마 위에서도 선명한 반투명 파스텔 형광펜 스타일 성별·급수·연령대 배지
 */
const GenderBadgeComponent: React.FC<GenderBadgeProps> = ({
  gender,
  grade,
  ageGroup,
}) => {
  const isFemale = gender === "FEMALE";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold tracking-tight ring-1 sm:px-2.5 sm:text-sm ${
        isFemale
          ? "bg-pink-400/25 text-pink-200 ring-pink-400/45"
          : "bg-sky-400/25 text-sky-200 ring-sky-400/45"
      }`}
    >
      <span>{isFemale ? "여" : "남"}</span>
      <span>·</span>
      <span>{grade}조</span>
      <span>·</span>
      <span>{AGE_GROUP_LABELS[ageGroup]}</span>
    </span>
  );
};

export const GenderBadge = React.memo(GenderBadgeComponent);
