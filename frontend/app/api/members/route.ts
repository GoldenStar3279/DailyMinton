import { connection, NextResponse } from "next/server";
import {
  GRADE_BASE_ELO,
  getAvatarGradientByGender,
} from "@/data/membersData";
import { getDbPool } from "@/lib/db";
import type {
  AgeGroup,
  Gender,
  Grade,
  InjuryLevel,
  MemberDto,
  MemberRole,
} from "@/types/home";

interface DbMemberRow {
  id: number;
  name: string;
  login_id: string;
  role: "ADMIN" | "MEMBER";
  gender: Gender;
  grade: Grade;
  age_group: AgeGroup;
  injury_level: InjuryLevel | null;
  elo_score: number;
  joined_at: string;
}

/**
 * PostgreSQL(dailyminton DB)의 members 테이블을 실시간으로 조회하여 반환합니다.
 */
export async function GET() {
  await connection();
  try {
    const pool = getDbPool();
    const { rows } = await pool.query<DbMemberRow>(
      `
      SELECT
        id,
        name,
        login_id,
        role,
        gender,
        grade,
        age_group,
        injury_level,
        elo_score,
        to_char(joined_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS joined_at
      FROM members
      WHERE is_active = TRUE
      ORDER BY id ASC;
      `
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json([]);
    }

    const mapped: MemberDto[] = rows.map((row) => {
      const uiRole: MemberRole =
        row.name === "한태호"
          ? "LEADER"
          : row.role === "ADMIN"
            ? "ADMIN"
            : "MEMBER";

      const defaultBio =
        row.name === "이정훈"
          ? "베드민턴 치고 싶어서 가입하게 되었습니다!"
          : row.name === "박수찬"
            ? "안녕하세요!"
            : ".";

      return {
        id: Number(row.id),
        name: row.name,
        nickname: row.login_id,
        role: uiRole,
        gender: row.gender,
        grade: row.grade,
        ageGroup: row.age_group,
        bio: defaultBio,
        joinedAt: row.joined_at,
        injuryLevel:
          row.injury_level === "MILD" || row.injury_level === "SEVERE"
            ? row.injury_level
            : "NONE",
        eloScore: Number(row.elo_score) || GRADE_BASE_ELO[row.grade],
        avatarGradient: getAvatarGradientByGender(row.gender, uiRole),
        avatarEmoji:
          uiRole === "LEADER" ? "🌸" : uiRole === "ADMIN" ? "🔥" : "🏸",
      };
    });

    return NextResponse.json(mapped);
  } catch (err) {
    console.error("[GET /api/members] DB error:", err);
    return NextResponse.json([]);
  }
}

/**
 * 신입 회원 추가 (POST /api/members) -> PostgreSQL members 테이블에 INSERT
 */
export async function POST(request: Request) {
  await connection();
  try {
    const body = (await request.json()) as {
      name?: string;
      nickname?: string;
      gender?: Gender;
      grade?: Grade;
      ageGroup?: AgeGroup;
      joinedAt?: string;
    };

    const rawName = (body.name || "").trim();
    if (!rawName) {
      return NextResponse.json(
        { error: "이름을 입력해주세요." },
        { status: 400 }
      );
    }

    const rawNickname = (body.nickname || rawName).trim();
    const gender: Gender = body.gender === "FEMALE" ? "FEMALE" : "MALE";
    const grade: Grade = body.grade || "F";
    const ageGroup: AgeGroup = body.ageGroup || "30S";
    const joinedAt = (body.joinedAt || "2026-11-18").trim();
    const eloScore = GRADE_BASE_ELO[grade] ?? 1200;

    const pool = getDbPool();
    const { rows } = await pool.query<{ id: number }>(
      `
      INSERT INTO members (
        name,
        login_id,
        password_hash,
        role,
        gender,
        grade,
        age_group,
        injury_level,
        elo_score,
        is_active,
        joined_at
      )
      VALUES ($1, $2, '{noop}1234', 'MEMBER', $3, $4, $5, 'NONE', $6, TRUE, $7::timestamptz)
      ON CONFLICT (login_id) DO UPDATE SET
        name = EXCLUDED.name,
        gender = EXCLUDED.gender,
        grade = EXCLUDED.grade,
        age_group = EXCLUDED.age_group,
        elo_score = EXCLUDED.elo_score,
        is_active = TRUE,
        joined_at = EXCLUDED.joined_at,
        updated_at = now()
      RETURNING id;
      `,
      [
        rawName,
        rawNickname,
        gender,
        grade,
        ageGroup,
        eloScore,
        `${joinedAt} 09:00:00+09`,
      ]
    );

    const insertedId = Number(rows[0]?.id) || Date.now();

    return NextResponse.json({
      success: true,
      id: insertedId,
    });
  } catch {
    return NextResponse.json(
      { success: false, id: Date.now() },
      { status: 200 }
    );
  }
}

/**
 * 회원 정보 수정 (운영진 권한 부여/회수, 회원 정보 변경, 경기 운영 종료 시 최종 ELO 일괄 반영)
 */
export async function PATCH(request: Request) {
  await connection();
  try {
    const body = (await request.json()) as {
      memberId?: number;
      role?: "ADMIN" | "MEMBER";
      name?: string;
      nickname?: string;
      gender?: Gender;
      grade?: Grade;
      ageGroup?: AgeGroup;
      injuryLevel?: InjuryLevel;
      eloScore?: number;
      eloUpdates?: Array<{ memberId: number; eloScore: number }>;
    };

    const pool = getDbPool();

    // 경기 운영 종료 시 다수 회원의 최종 ELO 일괄 반영
    if (Array.isArray(body.eloUpdates) && body.eloUpdates.length > 0) {
      const validUpdates = body.eloUpdates.filter(
        (u) =>
          Number.isInteger(Number(u.memberId)) &&
          Number(u.memberId) > 0 &&
          Number.isFinite(Number(u.eloScore))
      );

      if (validUpdates.length > 0) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const u of validUpdates) {
            await client.query(
              "UPDATE members SET elo_score = $1, updated_at = now() WHERE id = $2;",
              [Math.max(800, Math.round(Number(u.eloScore))), Number(u.memberId)]
            );
          }
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }

      return NextResponse.json({
        success: true,
        updatedCount: validUpdates.length,
      });
    }

    const memberId = Number(body.memberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return NextResponse.json(
        { error: "유효하지 않은 회원 ID입니다." },
        { status: 400 }
      );
    }

    const setClauses: string[] = ["updated_at = now()"];
    const values: Array<string | number> = [];

    const pushParam = (column: string, val: string | number) => {
      values.push(val);
      setClauses.push(`${column} = $${values.length}`);
    };

    if (body.role === "ADMIN" || body.role === "MEMBER") {
      pushParam("role", body.role);
    }
    if (body.name && body.name.trim()) {
      pushParam("name", body.name.trim());
    }
    if (body.nickname && body.nickname.trim()) {
      pushParam("login_id", body.nickname.trim());
    }
    if (body.gender === "MALE" || body.gender === "FEMALE") {
      pushParam("gender", body.gender);
    }
    if (body.grade && GRADE_BASE_ELO[body.grade]) {
      pushParam("grade", body.grade);
      pushParam("elo_score", GRADE_BASE_ELO[body.grade]);
    }
    if (body.ageGroup) {
      pushParam("age_group", body.ageGroup);
    }
    if (
      body.injuryLevel === "NONE" ||
      body.injuryLevel === "MILD" ||
      body.injuryLevel === "SEVERE"
    ) {
      pushParam("injury_level", body.injuryLevel);
    }
    if (typeof body.eloScore === "number" && Number.isFinite(body.eloScore)) {
      pushParam("elo_score", Math.max(800, Math.round(body.eloScore)));
    }

    values.push(memberId);
    await pool.query(
      `UPDATE members SET ${setClauses.join(", ")} WHERE id = $${values.length};`,
      values
    );

    return NextResponse.json({ success: true, memberId });
  } catch {
    return NextResponse.json(
      { success: false, message: "로컬 상태만 갱신되었습니다." },
      { status: 200 }
    );
  }
}

/**
 * 모임 멤버 강퇴 처리 (DELETE /api/members?memberId=...) -> PostgreSQL members 테이블에서 비활성화
 */
export async function DELETE(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const memberId = Number(searchParams.get("memberId"));

    if (!Number.isInteger(memberId) || memberId <= 0) {
      return NextResponse.json(
        { error: "유효하지 않은 회원 ID입니다." },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    await pool.query(
      "UPDATE members SET is_active = FALSE, updated_at = now() WHERE id = $1;",
      [memberId]
    );

    return NextResponse.json({ success: true, memberId });
  } catch {
    return NextResponse.json(
      { success: false, message: "로컬 상태만 갱신되었습니다." },
      { status: 200 }
    );
  }
}
