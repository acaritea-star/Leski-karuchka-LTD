\set ON_ERROR_STOP on
BEGIN;
\ir core.sql
\ir cash_geo_push.sql
ROLLBACK;
