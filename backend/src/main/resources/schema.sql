-- =========================================================
-- 데일리민턴 (DailyMinton) PostgreSQL 데이터베이스 스키마
-- 기준 문서: docs/데일리민턴 스키마.txt & docs/시스템 개발 지침.md
-- 설계 원칙:
--   1) 성능 최우선 (실시간 매칭/현황판/랭킹 조회를 위한 의도적 비정규화 및 복합 인덱스 구성)
--   2) 정식 회원(영구)과 게스트(당일 세션 한정 임시 데이터) 생명주기 엄격 분리
--   3) ENUM성 데이터는 VARCHAR + CHECK 제약조건 및 설정 테이블로 관리
-- =========================================================

-- 1. 정식 회원 테이블 (영구 데이터)
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
    elo_score       NUMERIC(7,2) NOT NULL,   -- 순수 ELO 경기력 점수(영구 누적)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 급수별 초기 기준 ELO 설정 테이블
CREATE TABLE IF NOT EXISTS grade_elo_base (
    grade       VARCHAR(5) PRIMARY KEY
                    CHECK (grade IN ('S','A','B','C','D','E','F','G')),
    base_elo    NUMERIC(7,2) NOT NULL,
    sort_order  INT NOT NULL   -- S가 1, G가 8처럼 급수 순서 비교용
);

-- 3. 연령대별 가점 설정 테이블
CREATE TABLE IF NOT EXISTS age_group_bonus (
    age_group   VARCHAR(10) PRIMARY KEY
                    CHECK (age_group IN ('UNDER_10','20S','30S','40S','50S','60S','OVER_70')),
    bonus_score NUMERIC(6,2) NOT NULL
);

-- 초기 시드 데이터 (1급수 = ELO 100점 가정, 하드코딩 방지용 설정 데이터)
INSERT INTO grade_elo_base (grade, base_elo, sort_order) VALUES
    ('S', 1800, 1),
    ('A', 1700, 2),
    ('B', 1600, 3),
    ('C', 1500, 4),
    ('D', 1400, 5),
    ('E', 1300, 6),
    ('F', 1200, 7),
    ('G', 1100, 8)
ON CONFLICT (grade) DO NOTHING;

INSERT INTO age_group_bonus (age_group, bonus_score) VALUES
    ('UNDER_10', 300),
    ('20S', 250),
    ('30S', 200),
    ('40S', 150),
    ('50S', 100),
    ('60S', 50),
    ('OVER_70', 0)
ON CONFLICT (age_group) DO NOTHING;

-- 4. 클럽 운영 설정 테이블 (단일 행 보장: id = 1)
CREATE TABLE IF NOT EXISTS club_settings (
    id                              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_courts                      INT NOT NULL DEFAULT 6,
    elo_k_factor                    NUMERIC(5,2) NOT NULL DEFAULT 32,
    grade_elo_gap                   NUMERIC(6,2) NOT NULL DEFAULT 100,  -- 1급수 차이 = ELO 몇 점
    female_grade_penalty            INT NOT NULL DEFAULT 2,             -- 여성 급수 하향 폭
    reservation_queue_threshold     INT NOT NULL DEFAULT 4,             -- 대기열 N인 미만 시 예약매칭 자동 활성화
    consecutive_game_limit          INT NOT NULL DEFAULT 2              -- 연속 게임 N회 이상 시 후순위
);

INSERT INTO club_settings (
    id, max_courts, elo_k_factor, grade_elo_gap, female_grade_penalty, reservation_queue_threshold, consecutive_game_limit
) VALUES (1, 6, 32, 100, 2, 4, 2)
ON CONFLICT (id) DO NOTHING;

-- 5. 코트 현황 테이블
CREATE TABLE IF NOT EXISTS courts (
    id              BIGSERIAL PRIMARY KEY,
    court_number    INT NOT NULL UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO courts (court_number, is_active) VALUES
    (1, TRUE), (2, TRUE), (3, TRUE), (4, TRUE), (5, FALSE), (6, FALSE)
ON CONFLICT (court_number) DO NOTHING;

-- 6. 정모 세션 테이블
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

-- 7. 게스트 테이블 (해당 정모 세션에 종속되는 임시 데이터)
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
    registered_by           BIGINT NOT NULL REFERENCES members(id),  -- 등록한 운영진
    registered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    converted_to_member_id  BIGINT REFERENCES members(id)            -- 정식 전환 시 참조용(수치 이력은 미이전)
);

-- 8. 정모 세션 참가자 테이블 (회원/게스트 통합 추상화 및 실시간 조회를 위한 session_elo_score 비정규화 컬럼 보유)
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

-- 9. 게임 매칭 테이블 (DRAFT -> CONFIRMED -> IN_PROGRESS -> COMPLETED / CANCELLED)
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

-- 10. 매칭별 참가자(팀 A/B) 테이블
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

-- 11. 정식 회원 영구 ELO 변동 이력 테이블 (게스트는 제외되어 영구 랭킹 오염 방지)
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

-- 12. 희망 동반자(함께 치고 싶은 인원) 테이블
CREATE TABLE IF NOT EXISTS preferred_teammates (
    id                  BIGSERIAL PRIMARY KEY,
    member_id           BIGINT NOT NULL REFERENCES members(id),
    preferred_member_id BIGINT NOT NULL REFERENCES members(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, preferred_member_id),
    CHECK (member_id <> preferred_member_id)
);

-- 13. 종목별 파트너 지정 테이블
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

-- 14. 기피 인원 설정 테이블 (본인 및 운영진 외 비공개)
CREATE TABLE IF NOT EXISTS avoid_preferences (
    id                  BIGSERIAL PRIMARY KEY,
    member_id           BIGINT NOT NULL REFERENCES members(id),
    avoided_member_id   BIGINT NOT NULL REFERENCES members(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, avoided_member_id),
    CHECK (member_id <> avoided_member_id)
);

-- 15. 최근 동반 게임 이력 테이블 (직전 게임 동반자 쿨다운 회피용)
CREATE TABLE IF NOT EXISTS recent_pairings (
    id                          BIGSERIAL PRIMARY KEY,
    session_participant_id_a    BIGINT NOT NULL REFERENCES session_participants(id),
    session_participant_id_b    BIGINT NOT NULL REFERENCES session_participants(id),
    last_match_id               BIGINT NOT NULL REFERENCES matches(id),
    last_played_at              TIMESTAMPTZ NOT NULL
);

-- 16. 정모 종료 결과 테이블 (당일 정식 회원 + 게스트 승률/순위 기록)
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

-- 17. 월간 랭킹 스냅샷 테이블 (매월 1일 기준 정식 회원 전용 등락 비교용)
CREATE TABLE IF NOT EXISTS monthly_ranking_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_date   DATE NOT NULL,   -- 매월 1일
    member_id       BIGINT NOT NULL REFERENCES members(id),
    elo_score       NUMERIC(7,2) NOT NULL,
    ranking_score   NUMERIC(7,2) NOT NULL,  -- elo_score + 연령 가점
    rank            INT NOT NULL,
    UNIQUE (snapshot_date, member_id)
);

-- 18. 모임 홈 화면 정식 회원 전용 상시 랭킹 뷰
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

-- =========================================================
-- 19. 성능 최적화 인덱스 (기본 명세 인덱스 + 빈번 조회 복합 인덱스)
-- =========================================================

-- [기본 명세 인덱스]
CREATE INDEX IF NOT EXISTS idx_session_participants_session_status ON session_participants (session_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_session_status ON matches (session_id, status);
CREATE INDEX IF NOT EXISTS idx_match_participants_match_id ON match_participants (match_id);
CREATE INDEX IF NOT EXISTS idx_elo_history_member_id ON elo_history (member_id);
CREATE INDEX IF NOT EXISTS idx_avoid_preferences_member_id ON avoid_preferences (member_id);

-- [성능 최우선 지침에 따른 추가 복합 인덱스: 풀스캔 및 정렬(filesort) 비용 제거]
-- 1) 홈 화면 최신 가입자 상단 정렬 및 상시 랭킹 조회 가속화
CREATE INDEX IF NOT EXISTS idx_members_active_joined_at ON members (is_active, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_active_elo ON members (is_active, elo_score DESC);

-- 2) 자동매칭 후보 탐색 (대기 상태 + 연속게임 횟수 + 누적게임 횟수 + 입장순서 정렬을 인덱스 스캔으로 처리)
CREATE INDEX IF NOT EXISTS idx_session_participants_matching_priority
    ON session_participants (session_id, status, consecutive_game_count ASC, total_game_count ASC, arrival_time ASC);

-- 3) 대기열 탭별(남복/여복/혼복) 조회 및 오래된 DRAFT 매칭 배치 정리 가속화
CREATE INDEX IF NOT EXISTS idx_matches_session_type_status
    ON matches (session_id, match_type, status, draft_created_at ASC);

-- 4) 매칭 우선순위(희망 인원, 파트너 지정, 최근 동반자 쿨다운) 고속 탐색
CREATE INDEX IF NOT EXISTS idx_preferred_teammates_member_id ON preferred_teammates (member_id);
CREATE INDEX IF NOT EXISTS idx_partner_preferences_member_type ON partner_preferences (member_id, match_type);
CREATE INDEX IF NOT EXISTS idx_recent_pairings_pair_played_at
    ON recent_pairings (session_participant_id_a, session_participant_id_b, last_played_at DESC);

-- 5) 정모 종료 결과 순위 및 월간 랭킹 등락 조회 가속화
CREATE INDEX IF NOT EXISTS idx_session_results_session_rank ON session_results (session_id, rank ASC);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_date_rank ON monthly_ranking_snapshots (snapshot_date, rank ASC);
