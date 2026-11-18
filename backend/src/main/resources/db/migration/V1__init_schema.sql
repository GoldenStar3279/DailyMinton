-- Flyway V1 초기 마이그레이션 스크립트 (docs/데일리민턴 스키마.txt & docs/시스템 개발 지침.md 준수)
-- 운영 및 개발 환경에서 스키마 버전을 일관되게 관리합니다.

CREATE TABLE IF NOT EXISTS members (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(50) NOT NULL,
    login_id        VARCHAR(50) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'MEMBER'
                        CHECK (role IN ('ADMIN', 'MEMBER')),
    gender          VARCHAR(10) NOT NULL
                        CHECK (gender IN ('MALE', 'FEMALE')),
    grade           VARCHAR(5) NOT NULL
                        CHECK (grade IN ('S','A','B','C','D','E','F','G')),
    age_group       VARCHAR(10) NOT NULL
                        CHECK (age_group IN ('UNDER_10','20S','30S','40S','50S','60S','OVER_70')),
    injury_level    VARCHAR(10) NOT NULL DEFAULT 'NONE'
                        CHECK (injury_level IN ('NONE','MILD','SEVERE')),
    elo_score       NUMERIC(7,2) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grade_elo_base (
    grade       VARCHAR(5) PRIMARY KEY
                    CHECK (grade IN ('S','A','B','C','D','E','F','G')),
    base_elo    NUMERIC(7,2) NOT NULL,
    sort_order  INT NOT NULL
);

CREATE TABLE IF NOT EXISTS age_group_bonus (
    age_group   VARCHAR(10) PRIMARY KEY
                    CHECK (age_group IN ('UNDER_10','20S','30S','40S','50S','60S','OVER_70')),
    bonus_score NUMERIC(6,2) NOT NULL
);

INSERT INTO grade_elo_base (grade, base_elo, sort_order) VALUES
    ('S', 1800, 1), ('A', 1700, 2), ('B', 1600, 3), ('C', 1500, 4),
    ('D', 1400, 5), ('E', 1300, 6), ('F', 1200, 7), ('G', 1100, 8)
ON CONFLICT (grade) DO NOTHING;

INSERT INTO age_group_bonus (age_group, bonus_score) VALUES
    ('UNDER_10', 300), ('20S', 250), ('30S', 200),
    ('40S', 150), ('50S', 100), ('60S', 50), ('OVER_70', 0)
ON CONFLICT (age_group) DO NOTHING;

CREATE TABLE IF NOT EXISTS club_settings (
    id                              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_courts                      INT NOT NULL DEFAULT 6,
    elo_k_factor                    NUMERIC(5,2) NOT NULL DEFAULT 32,
    grade_elo_gap                   NUMERIC(6,2) NOT NULL DEFAULT 100,
    female_grade_penalty            INT NOT NULL DEFAULT 2,
    reservation_queue_threshold     INT NOT NULL DEFAULT 4,
    consecutive_game_limit          INT NOT NULL DEFAULT 2
);

INSERT INTO club_settings (
    id, max_courts, elo_k_factor, grade_elo_gap, female_grade_penalty, reservation_queue_threshold, consecutive_game_limit
) VALUES (1, 6, 32, 100, 2, 4, 2)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS courts (
    id              BIGSERIAL PRIMARY KEY,
    court_number    INT NOT NULL UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO courts (court_number, is_active) VALUES
    (1, TRUE), (2, TRUE), (3, TRUE), (4, TRUE), (5, FALSE), (6, FALSE)
ON CONFLICT (court_number) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
    id              BIGSERIAL PRIMARY KEY,
    session_date    DATE NOT NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','CLOSED')),
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at       TIMESTAMPTZ,
    opened_by       BIGINT REFERENCES members(id),
    closed_by       BIGINT REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS guests (
    id                      BIGSERIAL PRIMARY KEY,
    session_id              BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    name                    VARCHAR(50) NOT NULL,
    gender                  VARCHAR(10) NOT NULL CHECK (gender IN ('MALE','FEMALE')),
    grade                   VARCHAR(5) NOT NULL
                                CHECK (grade IN ('S','A','B','C','D','E','F','G')),
    age_group               VARCHAR(10) NOT NULL
                                CHECK (age_group IN ('UNDER_10','20S','30S','40S','50S','60S','OVER_70')),
    injury_level            VARCHAR(10) NOT NULL DEFAULT 'NONE'
                                CHECK (injury_level IN ('NONE','MILD','SEVERE')),
    registered_by           BIGINT NOT NULL REFERENCES members(id),
    registered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    converted_to_member_id  BIGINT REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS session_participants (
    id                      BIGSERIAL PRIMARY KEY,
    session_id              BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_type        VARCHAR(10) NOT NULL CHECK (participant_type IN ('MEMBER','GUEST')),
    member_id               BIGINT REFERENCES members(id),
    guest_id                BIGINT REFERENCES guests(id),
    arrival_time            TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_time               TIMESTAMPTZ,
    status                  VARCHAR(10) NOT NULL DEFAULT 'ARRIVED'
                                CHECK (status IN ('ARRIVED','WAITING','IN_GAME','RESTING','LEFT')),
    session_elo_score       NUMERIC(7,2) NOT NULL,
    total_game_count        INT NOT NULL DEFAULT 0,
    consecutive_game_count  INT NOT NULL DEFAULT 0,
    cock_submitted          BOOLEAN NOT NULL DEFAULT FALSE,
    cock_quantity           INT,
    cock_submitted_at       TIMESTAMPTZ,
    CONSTRAINT chk_participant_ref CHECK (
        (participant_type = 'MEMBER' AND member_id IS NOT NULL AND guest_id IS NULL) OR
        (participant_type = 'GUEST'  AND guest_id  IS NOT NULL AND member_id IS NULL)
    ),
    UNIQUE (session_id, member_id),
    UNIQUE (session_id, guest_id)
);

CREATE TABLE IF NOT EXISTS matches (
    id                  BIGSERIAL PRIMARY KEY,
    session_id          BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    match_type          VARCHAR(15) NOT NULL
                            CHECK (match_type IN ('MEN_DOUBLE','WOMEN_DOUBLE','MIXED_DOUBLE')),
    status              VARCHAR(15) NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN ('DRAFT','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED')),
    origin              VARCHAR(10) NOT NULL CHECK (origin IN ('AUTO','MANUAL')),
    is_reserved_match   BOOLEAN NOT NULL DEFAULT FALSE,
    court_id            BIGINT REFERENCES courts(id),
    created_by          BIGINT REFERENCES members(id),
    draft_created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at        TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    winning_team        VARCHAR(1) CHECK (winning_team IN ('A','B'))
);

CREATE TABLE IF NOT EXISTS match_participants (
    id                      BIGSERIAL PRIMARY KEY,
    match_id                BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    session_participant_id  BIGINT NOT NULL REFERENCES session_participants(id),
    team                    VARCHAR(1) NOT NULL CHECK (team IN ('A','B')),
    elo_before              NUMERIC(7,2),
    elo_after               NUMERIC(7,2),
    elo_delta               NUMERIC(7,2),
    UNIQUE (match_id, session_participant_id)
);

CREATE TABLE IF NOT EXISTS elo_history (
    id              BIGSERIAL PRIMARY KEY,
    member_id       BIGINT NOT NULL REFERENCES members(id),
    match_id        BIGINT NOT NULL REFERENCES matches(id),
    session_id      BIGINT NOT NULL REFERENCES sessions(id),
    elo_before      NUMERIC(7,2) NOT NULL,
    elo_after       NUMERIC(7,2) NOT NULL,
    elo_delta       NUMERIC(7,2) NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preferred_teammates (
    id                  BIGSERIAL PRIMARY KEY,
    member_id           BIGINT NOT NULL REFERENCES members(id),
    preferred_member_id BIGINT NOT NULL REFERENCES members(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, preferred_member_id),
    CHECK (member_id <> preferred_member_id)
);

CREATE TABLE IF NOT EXISTS partner_preferences (
    id                  BIGSERIAL PRIMARY KEY,
    member_id           BIGINT NOT NULL REFERENCES members(id),
    partner_member_id   BIGINT NOT NULL REFERENCES members(id),
    match_type          VARCHAR(15) NOT NULL
                            CHECK (match_type IN ('MEN_DOUBLE','WOMEN_DOUBLE','MIXED_DOUBLE')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, partner_member_id, match_type),
    CHECK (member_id <> partner_member_id)
);

CREATE TABLE IF NOT EXISTS avoid_preferences (
    id                  BIGSERIAL PRIMARY KEY,
    member_id           BIGINT NOT NULL REFERENCES members(id),
    avoided_member_id   BIGINT NOT NULL REFERENCES members(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, avoided_member_id),
    CHECK (member_id <> avoided_member_id)
);

CREATE TABLE IF NOT EXISTS recent_pairings (
    id                          BIGSERIAL PRIMARY KEY,
    session_participant_id_a    BIGINT NOT NULL REFERENCES session_participants(id),
    session_participant_id_b    BIGINT NOT NULL REFERENCES session_participants(id),
    last_match_id               BIGINT NOT NULL REFERENCES matches(id),
    last_played_at              TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS session_results (
    id                  BIGSERIAL PRIMARY KEY,
    session_id          BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_type    VARCHAR(10) NOT NULL CHECK (participant_type IN ('MEMBER','GUEST')),
    member_id           BIGINT REFERENCES members(id),
    guest_id            BIGINT REFERENCES guests(id),
    wins                INT NOT NULL DEFAULT 0,
    losses              INT NOT NULL DEFAULT 0,
    win_rate            NUMERIC(5,2) NOT NULL DEFAULT 0,
    rank                INT,
    CONSTRAINT chk_result_ref CHECK (
        (participant_type = 'MEMBER' AND member_id IS NOT NULL AND guest_id IS NULL) OR
        (participant_type = 'GUEST'  AND guest_id  IS NOT NULL AND member_id IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS monthly_ranking_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,
    member_id       BIGINT NOT NULL REFERENCES members(id),
    elo_score       NUMERIC(7,2) NOT NULL,
    ranking_score   NUMERIC(7,2) NOT NULL,
    rank            INT NOT NULL,
    UNIQUE (snapshot_date, member_id)
);

CREATE OR REPLACE VIEW v_home_ranking AS
SELECT
    m.id,
    m.name,
    m.grade,
    m.gender,
    m.age_group,
    m.elo_score,
    m.elo_score + ab.bonus_score AS ranking_score,
    RANK() OVER (ORDER BY m.elo_score + ab.bonus_score DESC) AS rank
FROM members m
JOIN age_group_bonus ab ON ab.age_group = m.age_group
WHERE m.is_active = TRUE
ORDER BY ranking_score DESC;

CREATE INDEX IF NOT EXISTS idx_session_participants_session_status ON session_participants (session_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_session_status ON matches (session_id, status);
CREATE INDEX IF NOT EXISTS idx_match_participants_match_id ON match_participants (match_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_member_id ON elo_history (member_id);
CREATE INDEX IF NOT EXISTS idx_avoid_preferences_member_id ON avoid_preferences (member_id);
CREATE INDEX IF NOT EXISTS idx_members_active_joined_at ON members (is_active, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_active_elo ON members (is_active, elo_score DESC);
CREATE INDEX IF NOT EXISTS idx_session_participants_matching_priority
    ON session_participants (session_id, status, consecutive_game_count ASC, total_game_count ASC, arrival_time ASC);
CREATE INDEX IF NOT EXISTS idx_matches_session_type_status
    ON matches (session_id, match_type, status, draft_created_at ASC);
CREATE INDEX IF NOT EXISTS idx_preferred_teammates_member_id ON preferred_teammates (member_id);
CREATE INDEX IF NOT EXISTS idx_partner_preferences_member_type ON partner_preferences (member_id, match_type);
CREATE INDEX IF NOT EXISTS idx_recent_pairings_pair_played_at
    ON recent_pairings (session_participant_id_a, session_participant_id_b, last_played_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_results_session_rank ON session_results (session_id, rank ASC);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_date_rank ON monthly_ranking_snapshots (snapshot_date, rank ASC);
