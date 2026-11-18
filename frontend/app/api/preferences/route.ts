import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connection, NextResponse } from "next/server";
import type { MemberPreferenceDto } from "@/types/home";

const execFileAsync = promisify(execFile);

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/dailyminton";

interface PartnerRow {
  member_id: number;
  partner_member_id: number;
  match_type: "MEN_DOUBLE" | "WOMEN_DOUBLE" | "MIXED_DOUBLE";
}

interface AvoidRow {
  member_id: number;
  avoided_member_id: number;
}

/**
 * 전체 회원의 희망 파트너(남복/여복 1명, 혼복 1명) 및 기피 인원(최대 3명) 설정을 PostgreSQL에서 조회합니다.
 */
export async function GET() {
  await connection();
  try {
    const sql = `
      SELECT json_build_object(
        'partners', COALESCE((SELECT json_agg(json_build_object('member_id', member_id, 'partner_member_id', partner_member_id, 'match_type', match_type)) FROM partner_preferences), '[]'::json),
        'avoids', COALESCE((SELECT json_agg(json_build_object('member_id', member_id, 'avoided_member_id', avoided_member_id)) FROM avoid_preferences), '[]'::json)
      );
    `;

    const { stdout } = await execFileAsync(
      "psql",
      [DB_URL, "-X", "-q", "-t", "-A", "-c", sql],
      { timeout: 3000 }
    );

    const parsed = JSON.parse(stdout.trim() || "{}") as {
      partners?: PartnerRow[];
      avoids?: AvoidRow[];
    };

    const map: Record<number, MemberPreferenceDto> = {};
    const ensureEntry = (id: number): MemberPreferenceDto => {
      if (!map[id]) {
        map[id] = {
          memberId: id,
          sameGenderPartnerId: null,
          mixedPartnerId: null,
          avoidMemberIds: [],
        };
      }
      return map[id];
    };

    (parsed.partners || []).forEach((row) => {
      const entry = ensureEntry(Number(row.member_id));
      if (row.match_type === "MIXED_DOUBLE") {
        entry.mixedPartnerId = Number(row.partner_member_id);
      } else {
        entry.sameGenderPartnerId = Number(row.partner_member_id);
      }
    });

    (parsed.avoids || []).forEach((row) => {
      const entry = ensureEntry(Number(row.member_id));
      if (
        entry.avoidMemberIds.length < 3 &&
        !entry.avoidMemberIds.includes(Number(row.avoided_member_id))
      ) {
        entry.avoidMemberIds.push(Number(row.avoided_member_id));
      }
    });

    return NextResponse.json(map);
  } catch {
    return NextResponse.json({});
  }
}

/**
 * 특정 회원의 희망 파트너(남복/여복 1명 + 혼복 1명, 총 2명) 및 기피 인원(최대 3명)을 PostgreSQL에 저장합니다.
 */
export async function PUT(request: Request) {
  await connection();
  try {
    const body = (await request.json()) as {
      memberId?: number;
      memberGender?: "MALE" | "FEMALE";
      sameGenderPartnerId?: number | null;
      mixedPartnerId?: number | null;
      avoidMemberIds?: number[];
    };

    const memberId = Number(body.memberId);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return NextResponse.json(
        { error: "유효하지 않은 회원 ID입니다." },
        { status: 400 }
      );
    }

    const sameType =
      body.memberGender === "FEMALE" ? "WOMEN_DOUBLE" : "MEN_DOUBLE";
    const samePartner =
      body.sameGenderPartnerId && Number(body.sameGenderPartnerId) !== memberId
        ? Number(body.sameGenderPartnerId)
        : null;
    const mixedPartner =
      body.mixedPartnerId && Number(body.mixedPartnerId) !== memberId
        ? Number(body.mixedPartnerId)
        : null;

    const avoidIds = Array.from(
      new Set(
        (body.avoidMemberIds || [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0 && id !== memberId)
      )
    ).slice(0, 3);

    const statements: string[] = [
      "BEGIN;",
      `DELETE FROM partner_preferences WHERE member_id = ${memberId};`,
      `DELETE FROM avoid_preferences WHERE member_id = ${memberId};`,
    ];

    if (samePartner) {
      statements.push(
        `INSERT INTO partner_preferences (member_id, partner_member_id, match_type) VALUES (${memberId}, ${samePartner}, '${sameType}') ON CONFLICT DO NOTHING;`
      );
    }
    if (mixedPartner) {
      statements.push(
        `INSERT INTO partner_preferences (member_id, partner_member_id, match_type) VALUES (${memberId}, ${mixedPartner}, 'MIXED_DOUBLE') ON CONFLICT DO NOTHING;`
      );
    }
    for (const avoidId of avoidIds) {
      statements.push(
        `INSERT INTO avoid_preferences (member_id, avoided_member_id) VALUES (${memberId}, ${avoidId}) ON CONFLICT DO NOTHING;`
      );
    }
    statements.push("COMMIT;");

    await execFileAsync(
      "psql",
      [DB_URL, "-X", "-q", "-c", statements.join("\n")],
      { timeout: 3000 }
    );

    return NextResponse.json({
      success: true,
      preference: {
        memberId,
        sameGenderPartnerId: samePartner,
        mixedPartnerId: mixedPartner,
        avoidMemberIds: avoidIds,
      },
    });
  } catch {
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
