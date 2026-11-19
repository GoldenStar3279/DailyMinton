import { connection, NextResponse } from "next/server";
import type { Pool, PoolClient } from "pg";
import { GRADE_BASE_ELO } from "@/data/membersData";
import { getDbPool } from "@/lib/db";
import type {
  AgeGroup,
  Gender,
  Grade,
  MeetupGuestDto,
  MeetupScheduleDto,
} from "@/types/home";

interface SessionDbRow {
  id: number;
  session_date: string;
  title: string | null;
  selected_date: string | null;
  badge_day: string | null;
  badge_time: string | null;
  date_time_text: string | null;
  location: string | null;
  fee_text: string | null;
  max_participants: number | null;
  available_court_count: number | null;
  planned_courts: number[] | null;
  thumbnail_theme: "gymWindow" | "nightCourt" | null;
}

interface ParticipantDbRow {
  session_id: number;
  member_id: number;
}

interface GuestDbRow {
  id: number;
  session_id: number;
  name: string;
  gender: Gender;
  grade: Grade;
  age_group: AgeGroup;
}

let schemaReadyPromise: Promise<void> | null = null;

async function ensureMeetupSchema(pool: Pool): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          meta_key VARCHAR(100) PRIMARY KEY,
          meta_value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);

      await pool.query(`
        ALTER TABLE sessions
          ADD COLUMN IF NOT EXISTS title VARCHAR(120),
          ADD COLUMN IF NOT EXISTS selected_date VARCHAR(20),
          ADD COLUMN IF NOT EXISTS badge_day VARCHAR(30),
          ADD COLUMN IF NOT EXISTS badge_time VARCHAR(30),
          ADD COLUMN IF NOT EXISTS date_time_text VARCHAR(100),
          ADD COLUMN IF NOT EXISTS location VARCHAR(120),
          ADD COLUMN IF NOT EXISTS fee_text VARCHAR(120),
          ADD COLUMN IF NOT EXISTS max_participants INT NOT NULL DEFAULT 16,
          ADD COLUMN IF NOT EXISTS available_court_count INT NOT NULL DEFAULT 6,
          ADD COLUMN IF NOT EXISTS planned_courts JSONB NOT NULL DEFAULT '[1,2,3,4]'::jsonb,
          ADD COLUMN IF NOT EXISTS thumbnail_theme VARCHAR(20) NOT NULL DEFAULT 'gymWindow';
      `);
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
}

async function insertMemberParticipants(
  client: PoolClient,
  sessionId: number,
  memberIds: number[]
) {
  const uniqueIds = Array.from(
    new Set(memberIds.filter((id) => Number.isInteger(id) && id > 0))
  );
  if (uniqueIds.length === 0) return;

  await client.query(
    `
    INSERT INTO session_participants (
      session_id,
      participant_type,
      member_id,
      session_elo_score
    )
    SELECT $1, 'MEMBER', m.id, m.elo_score
    FROM members m
    WHERE m.id = ANY($2::bigint[])
    ON CONFLICT (session_id, member_id) DO NOTHING;
    `,
    [sessionId, uniqueIds]
  );
}

async function resolveDefaultAdminId(client: PoolClient): Promise<number | null> {
  const res = await client.query<{ id: number }>(
    `
    SELECT id
    FROM members
    WHERE is_active = TRUE
    ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, id ASC
    LIMIT 1;
    `
  );
  return res.rows[0]?.id ? Number(res.rows[0].id) : null;
}

async function fetchMeetupsFromDb(
  pool: Pool,
  meetupId?: number
): Promise<MeetupScheduleDto[]> {
  const sessionWhere =
    typeof meetupId === "number" && Number.isInteger(meetupId) && meetupId > 0
      ? "WHERE status = 'OPEN' AND id = $1"
      : "WHERE status = 'OPEN'";
  const sessionParams =
    typeof meetupId === "number" && Number.isInteger(meetupId) && meetupId > 0
      ? [meetupId]
      : [];

  const sessionsRes = await pool.query<SessionDbRow>(
    `
    SELECT
      id,
      to_char(session_date, 'YYYY-MM-DD') AS session_date,
      title,
      selected_date,
      badge_day,
      badge_time,
      date_time_text,
      location,
      fee_text,
      max_participants,
      available_court_count,
      planned_courts,
      thumbnail_theme
    FROM sessions
    ${sessionWhere}
    ORDER BY COALESCE(selected_date, to_char(session_date, 'YYYY-MM-DD')) ASC, id ASC;
    `,
    sessionParams
  );

  if (sessionsRes.rows.length === 0) {
    return [];
  }

  const sessionIds = sessionsRes.rows.map((r) => Number(r.id));

  const [participantsRes, guestsRes] = await Promise.all([
    pool.query<ParticipantDbRow>(
      `
      SELECT sp.session_id, sp.member_id
      FROM session_participants sp
      JOIN members m ON m.id = sp.member_id
      WHERE sp.session_id = ANY($1::bigint[])
        AND sp.participant_type = 'MEMBER'
        AND sp.member_id IS NOT NULL
        AND m.is_active = TRUE
      ORDER BY sp.id ASC;
      `,
      [sessionIds]
    ),
    pool.query<GuestDbRow>(
      `
      SELECT id, session_id, name, gender, grade, age_group
      FROM guests
      WHERE session_id = ANY($1::bigint[])
      ORDER BY id ASC;
      `,
      [sessionIds]
    ),
  ]);

  const memberIdsBySession = new Map<number, number[]>();
  participantsRes.rows.forEach((row) => {
    const sid = Number(row.session_id);
    const mid = Number(row.member_id);
    const arr = memberIdsBySession.get(sid) || [];
    arr.push(mid);
    memberIdsBySession.set(sid, arr);
  });

  const guestsBySession = new Map<number, MeetupGuestDto[]>();
  guestsRes.rows.forEach((row) => {
    const sid = Number(row.session_id);
    const arr = guestsBySession.get(sid) || [];
    arr.push({
      id: Number(row.id),
      name: row.name,
      gender: row.gender,
      grade: row.grade,
      ageGroup: row.age_group,
    });
    guestsBySession.set(sid, arr);
  });

  return sessionsRes.rows.map((row) => {
    const id = Number(row.id);
    const participantIds = memberIdsBySession.get(id) || [];
    const guests = guestsBySession.get(id) || [];
    const plannedCourts = Array.isArray(row.planned_courts)
      ? row.planned_courts.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [1, 2, 3, 4];

    return {
      id,
      title: row.title || "정모 일정",
      selectedDate: row.selected_date || row.session_date,
      badgeDay: row.badge_day || "",
      badgeTime: row.badge_time || "",
      dateTimeText: row.date_time_text || row.session_date,
      location: row.location || "체육관",
      feeText: row.fee_text || "입장료 무료",
      currentParticipants: participantIds.length + guests.length,
      maxParticipants: Number(row.max_participants) || 16,
      participantIds,
      guests,
      availableCourtCount: Number(row.available_court_count) || 6,
      plannedCourts,
      participantAvatars: [],
      thumbnailTheme:
        row.thumbnail_theme === "nightCourt" ? "nightCourt" : "gymWindow",
      isJoined: participantIds.includes(3),
    };
  });
}

/**
 * 정모 일정 및 참가자 명단 조회 (GET /api/meetups 또는 GET /api/meetups?id=1)
 */
export async function GET(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get("id");
    const meetupId = rawId ? Number(rawId) : undefined;

    const pool = getDbPool();
    await ensureMeetupSchema(pool);
    const meetups = await fetchMeetupsFromDb(pool, meetupId);
    return NextResponse.json({ source: "db", meetups });
  } catch (err) {
    console.error("[GET /api/meetups] DB fallback:", err);
    return NextResponse.json({
      source: "fallback",
      meetups: [],
    });
  }
}

/**
 * 새 정모 일정 생성 (POST /api/meetups)
 */
export async function POST(request: Request) {
  await connection();
  try {
    const body = (await request.json()) as Omit<MeetupScheduleDto, "id">;
    const pool = getDbPool();
    await ensureMeetupSchema(pool);

    const sessionDate = (body.selectedDate || "2026-11-20").trim();
    const client = await pool.connect();
    let createdId = 0;

    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: number }>(
        `
        INSERT INTO sessions (
          session_date,
          status,
          title,
          selected_date,
          badge_day,
          badge_time,
          date_time_text,
          location,
          fee_text,
          max_participants,
          available_court_count,
          planned_courts,
          thumbnail_theme
        )
        VALUES ($1::date, 'OPEN', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
        RETURNING id;
        `,
        [
          sessionDate,
          body.title || "새 정모",
          sessionDate,
          body.badgeDay || "",
          body.badgeTime || "",
          body.dateTimeText || sessionDate,
          body.location || "체육관",
          body.feeText || "입장료 무료",
          Number(body.maxParticipants) || 16,
          Number(body.availableCourtCount) || 6,
          JSON.stringify(body.plannedCourts || [1, 2, 3, 4]),
          body.thumbnailTheme === "nightCourt" ? "nightCourt" : "gymWindow",
        ]
      );

      createdId = Number(inserted.rows[0]?.id);
      if (createdId && Array.isArray(body.participantIds)) {
        await insertMemberParticipants(client, createdId, body.participantIds);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const [created] = await fetchMeetupsFromDb(pool, createdId);
    return NextResponse.json({
      success: true,
      meetup: created,
    });
  } catch (err) {
    console.error("[POST /api/meetups] error:", err);
    return NextResponse.json(
      { success: false, message: "로컬 상태만 반영되었습니다." },
      { status: 200 }
    );
  }
}

/**
 * 정모 일정 수정 / 참가자 토글 / 게스트 동기화 (PATCH /api/meetups)
 */
export async function PATCH(request: Request) {
  await connection();
  try {
    const body = (await request.json()) as {
      action?:
        | "update_info"
        | "toggle_member"
        | "remove_guest"
        | "sync_session_players";
      meetupId?: number;
      title?: string;
      selectedDate?: string;
      badgeDay?: string;
      badgeTime?: string;
      dateTimeText?: string;
      location?: string;
      feeText?: string;
      maxParticipants?: number;
      availableCourtCount?: number;
      plannedCourts?: number[];
      thumbnailTheme?: "gymWindow" | "nightCourt";
      memberId?: number;
      guestId?: number;
      participantIds?: number[];
      guests?: MeetupGuestDto[];
    };

    const meetupId = Number(body.meetupId);
    if (!Number.isInteger(meetupId) || meetupId <= 0) {
      return NextResponse.json(
        { error: "유효하지 않은 정모 ID입니다." },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    await ensureMeetupSchema(pool);

    if (body.action === "update_info") {
      const sessionDate = (body.selectedDate || "2026-11-20").trim();
      await pool.query(
        `
        UPDATE sessions
        SET
          session_date = $1::date,
          title = $2,
          selected_date = $3,
          badge_day = $4,
          badge_time = $5,
          date_time_text = $6,
          location = $7,
          fee_text = $8,
          max_participants = $9,
          available_court_count = $10,
          planned_courts = $11::jsonb,
          thumbnail_theme = $12
        WHERE id = $13;
        `,
        [
          sessionDate,
          body.title || "정모 일정",
          sessionDate,
          body.badgeDay || "",
          body.badgeTime || "",
          body.dateTimeText || sessionDate,
          body.location || "체육관",
          body.feeText || "입장료 무료",
          Number(body.maxParticipants) || 16,
          Number(body.availableCourtCount) || 6,
          JSON.stringify(body.plannedCourts || [1, 2, 3, 4]),
          body.thumbnailTheme === "nightCourt" ? "nightCourt" : "gymWindow",
          meetupId,
        ]
      );
    } else if (body.action === "toggle_member") {
      const memberId = Number(body.memberId);
      if (!Number.isInteger(memberId) || memberId <= 0) {
        return NextResponse.json(
          { error: "유효하지 않은 회원 ID입니다." },
          { status: 400 }
        );
      }
      const existing = await pool.query<{ id: number }>(
        "SELECT id FROM session_participants WHERE session_id = $1 AND member_id = $2;",
        [meetupId, memberId]
      );
      if ((existing.rowCount || 0) > 0) {
        await pool.query(
          "DELETE FROM session_participants WHERE session_id = $1 AND member_id = $2;",
          [meetupId, memberId]
        );
      } else {
        const client = await pool.connect();
        try {
          await insertMemberParticipants(client, meetupId, [memberId]);
        } finally {
          client.release();
        }
      }
    } else if (body.action === "remove_guest") {
      const guestId = Number(body.guestId);
      if (Number.isInteger(guestId) && guestId > 0) {
        await pool.query(
          "DELETE FROM session_participants WHERE session_id = $1 AND guest_id = $2;",
          [meetupId, guestId]
        );
        await pool.query(
          "DELETE FROM guests WHERE id = $1 AND session_id = $2;",
          [guestId, meetupId]
        );
      }
    } else if (body.action === "sync_session_players") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (Array.isArray(body.participantIds)) {
          const validMemberIds = Array.from(
            new Set(
              body.participantIds
                .map(Number)
                .filter((id) => Number.isInteger(id) && id > 0)
            )
          );
          if (validMemberIds.length === 0) {
            await client.query(
              "DELETE FROM session_participants WHERE session_id = $1 AND participant_type = 'MEMBER';",
              [meetupId]
            );
          } else {
            await client.query(
              `
              DELETE FROM session_participants
              WHERE session_id = $1
                AND participant_type = 'MEMBER'
                AND NOT (member_id = ANY($2::bigint[]));
              `,
              [meetupId, validMemberIds]
            );
            await insertMemberParticipants(client, meetupId, validMemberIds);
          }
        }

        if (Array.isArray(body.guests)) {
          const defaultAdminId = await resolveDefaultAdminId(client);
          await client.query(
            "DELETE FROM session_participants WHERE session_id = $1 AND participant_type = 'GUEST';",
            [meetupId]
          );
          await client.query("DELETE FROM guests WHERE session_id = $1;", [
            meetupId,
          ]);

          if (defaultAdminId !== null) {
            for (const g of body.guests) {
              const insertedGuest = await client.query<{ id: number }>(
                `
                INSERT INTO guests (
                  session_id,
                  name,
                  gender,
                  grade,
                  age_group,
                  injury_level,
                  registered_by
                )
                VALUES ($1, $2, $3, $4, $5, 'NONE', $6)
                RETURNING id;
                `,
                [
                  meetupId,
                  g.name,
                  g.gender === "FEMALE" ? "FEMALE" : "MALE",
                  g.grade || "D",
                  g.ageGroup || "30S",
                  defaultAdminId,
                ]
              );
              const guestId = Number(insertedGuest.rows[0]?.id);
              if (guestId) {
                await client.query(
                  `
                  INSERT INTO session_participants (
                    session_id,
                    participant_type,
                    guest_id,
                    session_elo_score
                  )
                  VALUES ($1, 'GUEST', $2, $3);
                  `,
                  [meetupId, guestId, GRADE_BASE_ELO[g.grade] ?? 1300]
                );
              }
            }
          }
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    const [updated] = await fetchMeetupsFromDb(pool, meetupId);
    return NextResponse.json({
      success: true,
      meetup: updated ?? null,
    });
  } catch (err) {
    console.error("[PATCH /api/meetups] error:", err);
    return NextResponse.json(
      { success: false, message: "로컬 상태만 반영되었습니다." },
      { status: 200 }
    );
  }
}

/**
 * 정모 일정 삭제 (DELETE /api/meetups?id=...)
 */
export async function DELETE(request: Request) {
  await connection();
  try {
    const { searchParams } = new URL(request.url);
    const meetupId = Number(searchParams.get("id"));
    if (!Number.isInteger(meetupId) || meetupId <= 0) {
      return NextResponse.json(
        { error: "유효하지 않은 정모 ID입니다." },
        { status: 400 }
      );
    }

    const pool = getDbPool();
    await ensureMeetupSchema(pool);
    await pool.query("DELETE FROM sessions WHERE id = $1;", [meetupId]);

    return NextResponse.json({ success: true, meetupId });
  } catch (err) {
    console.error("[DELETE /api/meetups] error:", err);
    return NextResponse.json(
      { success: false, message: "로컬 상태만 반영되었습니다." },
      { status: 200 }
    );
  }
}
