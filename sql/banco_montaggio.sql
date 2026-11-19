-- ============================================================================
--  BANCO: ARRIVI E MONTAGGIO  —  Minimal Gamers
--
--  Migrazione ADDITIVA: crea tre tabelle nuove e non tocca nessuna tabella
--  esistente (processed_orders, processed_order_components, warehouse_inventory
--  restano come sono). Si puo' rieseguire senza errori.
--
--  Cosa NON contengono, per regola (docs/regole-economiche.md):
--    - nessun costo o prezzo d'acquisto
--    - nessuna giacenza (le quantita' restano nella pagina Inventario)
--    - nessuna sostituzione (si confermano nel gestionale ordini)
--  Registrano soltanto fatti fisici: il pezzo e' arrivato, e' stato montato,
--  con quale seriale.
--
--  Come applicarla: Supabase -> SQL Editor -> incolla e RUN.
-- ============================================================================

-- 1) Un rigo per ogni pezzo di ogni PC: arrivo e montaggio.
--    tipo/codice/fornitore/nome sono la fotografia del pezzo al momento
--    dell'arrivo: se poi la scheda cambia, il banco se ne accorge.
--    Nessuna chiave esterna verso processed_order_components: quando una scheda
--    viene rielaborata le righe possono essere ricreate, e il banco le
--    ricollega per identita' invece di perdere gli arrivi.
CREATE TABLE IF NOT EXISTS banco_pezzi (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordine_id      TEXT NOT NULL,       -- processed_orders.shopify_order_id (es. 6001 oppure 6001.2)
    componente_id  BIGINT NOT NULL,     -- processed_order_components.id
    tipo           TEXT,
    codice         TEXT,
    fornitore      TEXT,
    nome           TEXT,
    quantita       INTEGER NOT NULL DEFAULT 1,
    arrivati       INTEGER NOT NULL DEFAULT 0,
    arrivato_il    TIMESTAMPTZ,
    arrivato_da    TEXT,
    codice_letto   TEXT,                -- codice a barre letto dalla scatola
    montato_il     TIMESTAMPTZ,
    montato_da     TEXT,
    seriale        TEXT,
    note           TEXT,
    creato_il      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aggiornato_il  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT banco_pezzi_ordine_componente UNIQUE (ordine_id, componente_id),
    CONSTRAINT banco_pezzi_arrivati_validi CHECK (arrivati >= 0)
);
CREATE INDEX IF NOT EXISTS ix_banco_pezzi_ordine ON banco_pezzi (ordine_id);

-- 2) Stato del PC finito. stato: 'assemblato' | 'collaudato'.
--    «Spedito» non sta qui: lo dice Shopify, come nel resto del gestionale.
CREATE TABLE IF NOT EXISTS banco_pc (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordine_id      TEXT NOT NULL UNIQUE,
    stato          TEXT NOT NULL DEFAULT 'assemblato',
    seriale_pc     TEXT,
    operatore      TEXT,
    assemblato_il  TIMESTAMPTZ,
    collaudato_il  TIMESTAMPTZ,
    note           TEXT,
    creato_il      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    aggiornato_il  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT banco_pc_stato_valido CHECK (stato IN ('assemblato','collaudato'))
);

-- 3) Codici a barre imparati: «questo codice sulla scatola e' quel codice in
--    scheda». Si crea solo quando un operatore lo conferma a mano.
CREATE TABLE IF NOT EXISTS banco_codici (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codice_letto  TEXT NOT NULL,        -- normalizzato (maiuscolo, solo lettere e cifre)
    codice        TEXT NOT NULL,        -- codice della scheda, normalizzato allo stesso modo
    tipo          TEXT,
    fornitore     TEXT,
    nome          TEXT,
    creato_da     TEXT,
    creato_il     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT banco_codici_unico UNIQUE (codice_letto, codice)
);

-- 4) Stesso accesso delle altre tabelle usate dal gestionale con la chiave
--    pubblica. Qui dentro non ci sono costi ne' dati dei clienti.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['banco_pezzi','banco_pc','banco_codici']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS p_all_%1$s ON %1$s;', t);
        EXECUTE format(
            'CREATE POLICY p_all_%1$s ON %1$s FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
            t);
    END LOOP;
END $$;
