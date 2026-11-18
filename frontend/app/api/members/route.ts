import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connection, NextResponse } from "next/server";
import {
  GRADE_BASE_ELO,
  getAvatarGradientByGender,
  INITIAL_MEMBERS,
} from "@/data/membersData";
import type {
  AgeGroup,
  Gender,
  Grade,
  MemberDto,
  MemberRole,
} from "@/types/home";

const execFileAsync = promisify(execFile);

interface DbMemberRow {
  id: number;
  name: string;
  login_id: string;
  role: "ADMIN" | "MEMBER";
  gender: Gender;
  grade: Grade;
  age_group: AgeGroup;
  elo_score: number;
  joined_at: string;
}

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/dailyminton";

function escapeSqlLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

/**
 * PostgreSQL(dailyminton DB)의 members 테이블을 실시간으로 조회하여 반환합니다.
 */
export async function GET() {
  await connection();
  try {
    const sql = `
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'login_id', login_id,
            'role', role,
            'gender', gender,
            'grade', grade,
            'age_group', age_group,
            'elo_score', elo_score,
            'joined_at', to_char(joined_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
          ) ORDER BY id ASC
        ),
        '[]'::json
      )
      FROM members
      WHERE is_active = TRUE;
    `;

    const { stdout } = await execFileAsync(
      "psql",
      [DB_URL, "-X", "-q", "-t", "-A", "-c", sql],
      { timeout: 3000 }
    );

    const rows: DbMemberRow[] = JSON.parse(stdout.trim() || "[]");
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(INITIAL_MEMBERS);
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
        eloScore: Number(row.elo_score) || GRADE_BASE_ELO[row.grade],
        avatarGradient: getAvatarGradientByGender(row.gender, uiRole),
        avatarEmoji:
          uiRole === "LEADER" ? "🌸" : uiRole === "ADMIN" ? "🔥" : "🏸",
      };
    });

    return NextResponse.json(mapped);
  } catch {
    return NextResponse.json(INITIAL_MEMBERS);
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
      bio?: string;
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

    const safeName = escapeSqlLiteral(rawName);
    const safeNickname = escapeSqlLiteral(rawNickname);
    const safeJoinedAt = escapeSqlLiteral(joinedAt);

    const sql = `
      INSERT INTO members (name, login_id, password_hash, role, gender, grade, age_group, injury_level, elo_score, is_active, joined_at)
      VALUES ('${safeName}', '${safeNickname}', '{noop}1234', 'MEMBER', '${gender}', '${grade}', '${ageGroup}', 'NONE', ${eloScore}, TRUE, '${safeJoinedAt} 09:00:00+09')
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
    `;

    const { stdout } = await execFileAsync(
      "psql",
      [DB_URL, "-X", "-q", "-t", "-A", "-c", sql],
      { timeout: 3000 }
    );

    const insertedId =
      Number(stdout.trim().split("\n")[0]) || Date.now();

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
 * 회원 정보 수정 (운영진 권한 부여/회수 또는 회원관리/프로필에서 급수·성별·연령대·닉네임 변경 시 PostgreSQL DB에 즉시 반영)
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
      eloScore?: number;
      eloUpdates?: Array<{ memberId: number; eloScore: number }>;
    };

    // 경기 운영 종료 시 다수 회원의 최종 ELO 일괄 반영
    if (Array.isArray(body.eloUpdates) && body.eloUpdates.length > 0) {
      const validUpdates = body.eloUpdates.filter(
        (u) =>
          Number.isInteger(Number(u.memberId)) &&
          Number(u.memberId) > 0 &&
          Number.isFinite(Number(u.eloScore))
      );
      if (validUpdates.length > 0) {
        const sqlBatch = validUpdates
          .map(
            (u) =>
              `UPDATE members SET elo_score = ${Math.max(800, Math.round(Number(u.eloScore)))}, updated_at = now() WHERE id = ${Number(u.memberId)};`
          )
          .join("\n");
        await execFileAsync("psql", [DB_URL, "-X", "-q", "-c", sqlBatch], {
          timeout: 5000,
        });
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

    const updates: string[] = ["updated_at = now()"];

    if (body.role === "ADMIN" || body.role === "MEMBER") {
      updates.push(`role = '${body.role}'`);
    }
    if (body.name && body.name.trim()) {
      updates.push(`name = '${escapeSqlLiteral(body.name.trim())}'`);
    }
    if (body.nickname && body.nickname.trim()) {
      updates.push(`login_id = '${escapeSqlLiteral(body.nickname.trim())}'`);
    }
    if (body.gender === "MALE" || body.gender === "FEMALE") {
      updates.push(`gender = '${body.gender}'`);
    }
    if (body.grade && GRADE_BASE_ELO[body.grade]) {
      updates.push(`grade = '${body.grade}'`);
      updates.push(`elo_score = ${GRADE_BASE_ELO[body.grade]}`);
    }
    if (body.ageGroup) {
      updates.push(`age_group = '${escapeSqlLiteral(body.ageGroup)}'`);
    }
    if (typeof body.eloScore === "number" && Number.isFinite(body.eloScore)) {
      updates.push(
        `elo_score = ${Math.max(800, Math.round(body.eloScore))}`
      );
    }

    const sql = `UPDATE members SET ${updates.join(", ")} WHERE id = ${memberId};`;

    await execFileAsync("psql", [DB_URL, "-X", "-q", "-c", sql], {
      timeout: 3000,
    });

    return NextResponse.json({ success: true, memberId });
  } catch {
    return NextResponse.json(
      { success: false, message: "로컬 상태만 갱신되었습니다." },
      { status: 200 }
    );
  }
}

/**
 * 모임 멤버 강퇴 처리 (DELETE /api/members?memberId=...) -> PostgreSQL members 테이블에서 비활성화/삭제
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

    const sql = `UPDATE members SET is_active = FALSE, updated_at = now() WHERE id = ${memberId};`;

    await execFileAsync("psql", [DB_URL, "-X", "-q", "-c", sql], {
      timeout: 3000,
    });

    return NextResponse.json({ success: true, memberId });
  } catch {
    return NextResponse.json(
      { success: false, message: "로컬 상태만 갱신되었습니다." },
      { status: 200 }
    );
  }
}
