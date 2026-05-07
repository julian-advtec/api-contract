--
-- PostgreSQL database dump
--

\restrict qDSvxb4YNccfgygi7YmG671jad55fdOmsGrikLG2ihR3dKLbRJrSdyhhCQ5EE91

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, email, full_name, role, password, is_active, is_email_verified, created_by, updated_by, created_at, updated_at, two_factor_code, two_factor_expires, two_factor_attempts, reset_token, reset_token_expires) FROM stdin;
ea64f586-7663-43b1-bcc4-9522f0e3c1a2	sistemas2	prueba2fa@lamaria.gov.co	Administrador del Sistema	admin	$2b$12$lL.mDwWmajyXVQpLYZSz9OFLntg0dIHhn4AmTSZPOXZY5yVsaO2wy	t	t	system_seed	\N	2026-04-13 07:15:59.84219	2026-04-15 07:20:30.574	\N	\N	0	\N	\N
c091a936-dc64-4784-a064-05fa6c8bbed3	juridica2	sistemas2@lamaria.gov.co	Jurida	juridica	$2b$12$i8grmvRarkXsJ6BNd5SCi.g.Mw4/JrzuPaM74QUm42c5TBmbC.fhK	t	f	\N	\N	2026-04-27 07:13:53.63	2026-04-29 11:58:46.537501	994381	2026-04-29 12:08:00.512	0	\N	\N
\.


--
-- PostgreSQL database dump complete
--

\unrestrict qDSvxb4YNccfgygi7YmG671jad55fdOmsGrikLG2ihR3dKLbRJrSdyhhCQ5EE91

