import { connection, NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import type { MemberPreferenceDto } from "@/types/home";

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
    const pool = getDbPool();
    const [partnerResult, avoidResult] = await Promise.all([
      pool.query<PartnerRow>(
        "SELECT member_id, partner_member_id, match_type FROM partner_preferences;"
      ),
      pool.query<AvoidRow>(
        "SELECT member_id, avoided_member_id FROM avoid_preferences;"
      ),
    ]);

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

    partnerResult.rows.forEach((row) => {
      const entry = ensureEntry(Number(row.member_id));
      if (row.match_type === "MIXED_DOUBLE") {
        entry.mixedPartnerId = Number(row.partner_member_id);
      } else {
        entry.sameGenderPartnerId = Number(row.partner_member_id);
      }
    });

    avoidResult.rows.forEach((row) => {
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

    const pool = getDbPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM partner_preferences WHERE member_id = $1;",
        [memberId]
      );
      await client.query(
        "DELETE FROM avoid_preferences WHERE member_id = $1;",
        [memberId]
      );

      if (samePartner) {
        await client.query(
          "INSERT INTO partner_preferences (member_id, partner_member_id, match_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING;",
          [memberId, samePartner, sameType]
        );
      }
      if (mixedPartner) {
        await client.query(
          "INSERT INTO partner_preferences (member_id, partner_member_id, match_type) VALUES ($1, $2, 'MIXED_DOUBLE') ON CONFLICT DO NOTHING;",
          [memberId, mixedPartner]
        );
      }
      for (const avoidId of avoidIds) {
        await client.query(
          "INSERT INTO avoid_preferences (member_id, avoided_member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING;",
          [memberId, avoidId]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

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
