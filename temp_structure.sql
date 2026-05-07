--
-- PostgreSQL database dump
--

\restrict Yyzwc01094BzRUStYQa3ODxjdm1f18IgGqats6PZhLoRcdHegDggZneuNP5Ad3V

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
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: asesor_gerencia_documentos_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asesor_gerencia_documentos_estado_enum AS ENUM (
    'DISPONIBLE',
    'EN_REVISION',
    'COMPLETADO_ASESOR_GERENCIA',
    'OBSERVADO_ASESOR_GERENCIA',
    'RECHAZADO_ASESOR_GERENCIA'
);


--
-- Name: auditor_documentos_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.auditor_documentos_estado_enum AS ENUM (
    'DISPONIBLE',
    'EN_REVISION',
    'APROBADO',
    'OBSERVADO',
    'RECHAZADO',
    'COMPLETADO'
);


--
-- Name: contabilidad_documentos_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contabilidad_documentos_estado_enum AS ENUM (
    'DISPONIBLE',
    'EN_REVISION',
    'OBSERVADO',
    'RECHAZADO',
    'GLOSADO',
    'COMPLETADO',
    'PROCESADO'
);


--
-- Name: contabilidad_documentos_tipo_causacion_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contabilidad_documentos_tipo_causacion_enum AS ENUM (
    'NOTA_DEBITO',
    'NOTA_CREDITO',
    'COMPROBANTE_EGRESO',
    'OTRO'
);


--
-- Name: contratos_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contratos_estado_enum AS ENUM (
    'BORRADOR',
    'EN_APROBACION',
    'FIRMADO',
    'EN_EJECUCION',
    'TERMINADO',
    'LIQUIDADO',
    'SUSPENDIDO'
);


--
-- Name: contratos_tipo_contrato_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contratos_tipo_contrato_enum AS ENUM (
    'PRESTACION_SERVICIOS',
    'SUMINISTRO',
    'OBRA',
    'CONSULTORIA',
    'COMPRAVENTA',
    'ARRENDAMIENTO',
    'OTRO'
);


--
-- Name: documentos_contratista_tipo_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.documentos_contratista_tipo_enum AS ENUM (
    'CEDULA',
    'RUT',
    'CERTIFICADO_BANCARIO',
    'CERTIFICADO_EXPERIENCIA',
    'CERTIFICADO_NO_PLANTA',
    'CERTIFICADO_ANTECEDENTES',
    'CERTIFICADO_IDONEIDAD',
    'DECLARACION_BIENES',
    'DECLARACION_INHABILIDADES',
    'EXAMEN_INGRESO',
    'GARANTIA',
    'HOJA_VIDA_SIGEP',
    'LIBRETA_MILITAR',
    'PANTALLAZO_SECOP',
    'PROPUESTA',
    'PUBLICACION_GT',
    'REDAM',
    'SARLAFT',
    'SEGURIDAD_SOCIAL',
    'TARJETA_PROFESIONAL'
);


--
-- Name: documentos_contrato_tipo_documento_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.documentos_contrato_tipo_documento_enum AS ENUM (
    'CDP',
    'RP',
    'POLIZA_CUMPLIMIENTO',
    'POLIZA_CALIDAD',
    'POLIZA_RC',
    'MINUTA',
    'ACTA_INICIO',
    'POLIZA',
    'INFORME_SUPERVISION',
    'FACTURA',
    'MODIFICACION',
    'ACTA_LIQUIDACION',
    'OTRO'
);


--
-- Name: modificaciones_contrato_tipo_modificacion_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.modificaciones_contrato_tipo_modificacion_enum AS ENUM (
    'ADICION',
    'PRORROGA',
    'SUSPENSION',
    'TERMINACION',
    'OTROSI',
    'LIQUIDACION'
);


--
-- Name: obligaciones_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.obligaciones_estado_enum AS ENUM (
    'PENDIENTE',
    'EN_EJECUCION',
    'CUMPLIDA',
    'VENCIDA'
);


--
-- Name: polizas_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.polizas_estado_enum AS ENUM (
    'VIGENTE',
    'POR_VENCER',
    'VENCIDA',
    'CANCELADA'
);


--
-- Name: polizas_tipo_poliza_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.polizas_tipo_poliza_enum AS ENUM (
    'CUMPLIMIENTO',
    'ANTICIPO',
    'CALIDAD',
    'RESPONSABILIDAD_CIVIL',
    'SALARIOS_PRESTACIONES'
);


--
-- Name: rendicion_cuentas_documentos_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rendicion_cuentas_documentos_estado_enum AS ENUM (
    'PENDIENTE',
    'EN_REVISION',
    'APROBADO',
    'OBSERVADO',
    'RECHAZADO',
    'COMPLETADO',
    'ESPERA_APROBACION_GERENCIA',
    'APROBADO_POR_GERENCIA'
);


--
-- Name: rendicion_cuentas_historial_estadoanterior_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rendicion_cuentas_historial_estadoanterior_enum AS ENUM (
    'PENDIENTE',
    'EN_REVISION',
    'APROBADO',
    'OBSERVADO',
    'RECHAZADO',
    'COMPLETADO',
    'ESPERA_APROBACION_GERENCIA',
    'APROBADO_POR_GERENCIA'
);


--
-- Name: rendicion_cuentas_historial_estadonuevo_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rendicion_cuentas_historial_estadonuevo_enum AS ENUM (
    'PENDIENTE',
    'EN_REVISION',
    'APROBADO',
    'OBSERVADO',
    'RECHAZADO',
    'COMPLETADO',
    'ESPERA_APROBACION_GERENCIA',
    'APROBADO_POR_GERENCIA'
);


--
-- Name: signatures_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.signatures_type_enum AS ENUM (
    'image',
    'pdf'
);


--
-- Name: tesoreria_documentos_estado_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tesoreria_documentos_estado_enum AS ENUM (
    'DISPONIBLE',
    'EN_REVISION',
    'COMPLETADO_TESORERIA',
    'OBSERVADO_TESORERIA',
    'RECHAZADO_TESORERIA'
);


--
-- Name: users_role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.users_role_enum AS ENUM (
    'admin',
    'juridica',
    'radicador',
    'supervisor',
    'auditor_cuentas',
    'contabilidad',
    'tesoreria',
    'asesor_gerencia',
    'rendicion_cuentas'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: asesor_gerencia_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asesor_gerencia_documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado public.asesor_gerencia_documentos_estado_enum DEFAULT 'DISPONIBLE'::public.asesor_gerencia_documentos_estado_enum NOT NULL,
    observaciones text,
    "aprobacionPath" character varying,
    "fechaAprobacion" timestamp without time zone,
    "fechaCreacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaActualizacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaInicioRevision" timestamp without time zone,
    "fechaFinRevision" timestamp without time zone,
    firma_aplicada boolean DEFAULT false NOT NULL,
    "comprobanteFirmadoPath" character varying,
    "documentoId" uuid,
    "asesorId" uuid NOT NULL
);


--
-- Name: auditor_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditor_documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado public.auditor_documentos_estado_enum DEFAULT 'DISPONIBLE'::public.auditor_documentos_estado_enum NOT NULL,
    fecha_inicio_revision timestamp without time zone,
    fecha_fin_revision timestamp without time zone,
    fecha_aprobacion timestamp without time zone,
    observaciones text,
    correcciones text,
    rp_path character varying(500),
    cdp_path character varying(500),
    poliza_path character varying(500),
    certificado_bancario_path character varying(500),
    minuta_path character varying(500),
    acta_inicio_path character varying(500),
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL,
    documento_id uuid NOT NULL,
    auditor_id uuid NOT NULL
);


--
-- Name: bitacora_sistema; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bitacora_sistema (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    modulo character varying(50) NOT NULL,
    accion character varying(100) NOT NULL,
    descripcion text,
    rol_usuario character varying(50) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    usuario_id uuid,
    documento_id uuid,
    nombre_usuario character varying(255),
    numero_radicado character varying(255),
    numero_contrato character varying(100),
    documento_contratista character varying(100),
    nombre_contratista character varying(255)
);


--
-- Name: contabilidad_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contabilidad_documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado public.contabilidad_documentos_estado_enum DEFAULT 'DISPONIBLE'::public.contabilidad_documentos_estado_enum NOT NULL,
    "tipoProceso" character varying(50) DEFAULT 'nada'::character varying,
    tiene_glosa boolean,
    tipo_causacion public.contabilidad_documentos_tipo_causacion_enum,
    observaciones text,
    correcciones text,
    glosa_path character varying(500),
    causacion_path character varying(500),
    extracto_path character varying(500),
    comprobante_egreso_path character varying(500),
    fecha_glosa timestamp without time zone,
    fecha_causacion timestamp without time zone,
    fecha_extracto timestamp without time zone,
    fecha_comprobante_egreso timestamp without time zone,
    fecha_inicio_revision timestamp without time zone,
    fecha_fin_revision timestamp without time zone,
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL,
    documento_id uuid NOT NULL,
    contador_id uuid NOT NULL
);


--
-- Name: contratistas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratistas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tipo_documento character varying(10) DEFAULT 'CC'::character varying NOT NULL,
    documento_identidad character varying(20) NOT NULL,
    razon_social character varying(200) NOT NULL,
    representante_legal character varying(200),
    documento_representante character varying(20),
    telefono character varying(15),
    email character varying(100),
    direccion text,
    departamento character varying(50),
    ciudad character varying(50),
    tipo_contratista character varying(50),
    estado character varying(20) DEFAULT 'ACTIVO'::character varying NOT NULL,
    numero_contrato character varying(50),
    cargo character varying(100),
    objetivo_contrato text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: contratos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    vigencia character varying(4) NOT NULL,
    numero_contrato character varying(50) NOT NULL,
    tipo_contrato public.contratos_tipo_contrato_enum DEFAULT 'PRESTACION_SERVICIOS'::public.contratos_tipo_contrato_enum NOT NULL,
    objeto text NOT NULL,
    valor numeric(15,2) NOT NULL,
    plazo_dias integer NOT NULL,
    cdp character varying(50),
    rp character varying(50),
    fecha_firma date NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_terminacion date NOT NULL,
    se_desembolsa_anticipo boolean DEFAULT false NOT NULL,
    porcentaje_anticipo numeric(5,2),
    valor_anticipo numeric(15,2),
    fecha_desembolso_anticipo date,
    adiciones numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    valor_total numeric(15,2) NOT NULL,
    supervisor character varying(100),
    estado public.contratos_estado_enum DEFAULT 'BORRADOR'::public.contratos_estado_enum NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL,
    creado_por character varying(100),
    ultimo_usuario character varying(100),
    pagado_acumulado numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    comprometido numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    saldo_disponible numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    anticipo_pendiente_amortizar numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    historial_cambios json,
    proveedor_id uuid
);


--
-- Name: documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    numero_radicado character varying(50) NOT NULL,
    primer_radicado_ano boolean DEFAULT false NOT NULL,
    es_ultimo_radicado boolean DEFAULT false,
    numero_contrato character varying(50) NOT NULL,
    nombre_contratista character varying(200) NOT NULL,
    documento_contratista character varying(50) NOT NULL,
    fecha_inicio timestamp without time zone NOT NULL,
    fecha_fin timestamp without time zone NOT NULL,
    estado character varying(50) DEFAULT 'RADICADO'::character varying NOT NULL,
    cuenta_cobro character varying,
    seguridad_social character varying,
    informe_actividades character varying,
    descripcion_cuenta_cobro character varying(200) DEFAULT 'Cuenta de Cobro'::character varying,
    descripcion_seguridad_social character varying(200) DEFAULT 'Seguridad Social'::character varying,
    descripcion_informe_actividades character varying(200) DEFAULT 'Informe de Actividades'::character varying,
    observacion text,
    nombre_radicador character varying(100) NOT NULL,
    usuario_radicador character varying(50) NOT NULL,
    usuario_asignado_nombre character varying(100),
    fecha_radicacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL,
    ruta_carpeta_radicado text NOT NULL,
    ultimo_acceso timestamp without time zone,
    ultimo_usuario character varying(100),
    comentarios text,
    correcciones text,
    fecha_limite_revision timestamp without time zone,
    token_publico character varying,
    token_activo boolean DEFAULT false NOT NULL,
    token_expira_en timestamp without time zone,
    contratista_id character varying,
    historial_estados json,
    radicador_id uuid NOT NULL,
    usuario_asignado_id uuid
);


--
-- Name: documentos_contratista; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_contratista (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    contratista_id uuid NOT NULL,
    tipo public.documentos_contratista_tipo_enum NOT NULL,
    nombre_archivo character varying NOT NULL,
    ruta_archivo character varying NOT NULL,
    tipo_mime character varying,
    tamano_bytes integer,
    fecha_subida timestamp without time zone DEFAULT now() NOT NULL,
    subido_por character varying
);


--
-- Name: documentos_contrato; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_contrato (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    nombre_archivo character varying(255) NOT NULL,
    ruta_archivo text NOT NULL,
    tipo_documento public.documentos_contrato_tipo_documento_enum NOT NULL,
    descripcion character varying(500),
    version integer DEFAULT 1 NOT NULL,
    es_version_actual boolean DEFAULT true NOT NULL,
    documento_anterior_id character varying,
    tamano_bytes bigint,
    mime_type character varying(100) NOT NULL,
    contrato_id uuid NOT NULL,
    cargado_por character varying(100) NOT NULL,
    fecha_carga timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: modificaciones_contrato; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modificaciones_contrato (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tipo_modificacion public.modificaciones_contrato_tipo_modificacion_enum NOT NULL,
    numero_modificacion character varying(50) NOT NULL,
    fecha_modificacion date NOT NULL,
    descripcion text NOT NULL,
    valor_modificacion numeric(15,2),
    dias_modificacion integer,
    nueva_fecha_terminacion date,
    aprobada boolean DEFAULT false NOT NULL,
    fecha_aprobacion date,
    aprobada_por character varying(100),
    ruta_documento text,
    contrato_id uuid NOT NULL,
    solicitada_por character varying(100) NOT NULL,
    fecha_solicitud timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: obligaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obligaciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    descripcion text NOT NULL,
    fecha_limite date NOT NULL,
    fecha_cumplimiento date,
    responsable character varying(100),
    estado public.obligaciones_estado_enum DEFAULT 'PENDIENTE'::public.obligaciones_estado_enum NOT NULL,
    observaciones text,
    evidencia text,
    contrato_id uuid NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: polizas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.polizas (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    numero_poliza character varying(50) NOT NULL,
    tipo_poliza public.polizas_tipo_poliza_enum NOT NULL,
    aseguradora character varying(100) NOT NULL,
    valor_asegurado numeric(15,2) NOT NULL,
    fecha_expedicion date NOT NULL,
    fecha_vigencia_inicio date NOT NULL,
    fecha_vigencia_fin date NOT NULL,
    aprobada boolean DEFAULT false NOT NULL,
    fecha_aprobacion date,
    aprobada_por character varying(100),
    estado public.polizas_estado_enum DEFAULT 'VIGENTE'::public.polizas_estado_enum NOT NULL,
    observaciones text,
    ruta_archivo text,
    contrato_id uuid NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedores (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tipo_identificacion character varying(3) NOT NULL,
    numero_identificacion character varying(20) NOT NULL,
    nombre_razon_social character varying(200) NOT NULL,
    direccion character varying(200),
    telefono character varying(50),
    email character varying(100),
    contacto_nombre character varying(100),
    contacto_telefono character varying(50),
    contacto_email character varying(100),
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT now() NOT NULL,
    fecha_actualizacion timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: registros_acceso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_acceso (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    documento_id character varying NOT NULL,
    usuario_id character varying NOT NULL,
    nombre_usuario character varying(100) NOT NULL,
    rol_usuario character varying(50) NOT NULL,
    accion character varying(50) NOT NULL,
    detalles text,
    fecha_acceso timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rendicion_cuentas_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rendicion_cuentas_documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "documentoId" uuid NOT NULL,
    "responsableId" uuid,
    estado public.rendicion_cuentas_documentos_estado_enum DEFAULT 'PENDIENTE'::public.rendicion_cuentas_documentos_estado_enum NOT NULL,
    observaciones text,
    "fechaAsignacion" timestamp without time zone,
    "fechaInicioRevision" timestamp without time zone,
    "fechaDecision" timestamp without time zone,
    "fechaCreacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaActualizacion" timestamp without time zone DEFAULT now() NOT NULL,
    "informeRendicionPath" text,
    "documentosAdjuntosPath" text,
    "montoRendido" numeric(15,2),
    "montoAprobado" numeric(15,2),
    "informesPresentados" jsonb DEFAULT '[]'::jsonb,
    "documentosAdjuntos" jsonb DEFAULT '[]'::jsonb
);


--
-- Name: rendicion_cuentas_historial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rendicion_cuentas_historial (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "documentoId" uuid NOT NULL,
    "usuarioId" uuid NOT NULL,
    "estadoAnterior" public.rendicion_cuentas_historial_estadoanterior_enum,
    "estadoNuevo" public.rendicion_cuentas_historial_estadonuevo_enum NOT NULL,
    observacion text,
    accion character varying(50) NOT NULL,
    "fechaCreacion" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signatures (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    type public.signatures_type_enum NOT NULL,
    encrypted_data text NOT NULL,
    mime_type character varying(50) NOT NULL,
    file_size integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: supervisor_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado character varying(50) DEFAULT 'DISPONIBLE'::character varying NOT NULL,
    observacion text,
    correcciones text,
    "nombreArchivoSupervisor" character varying(255),
    "pazSalvo" character varying(255),
    "fechaCreacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaActualizacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaInicioRevision" timestamp without time zone,
    "fechaFinRevision" timestamp without time zone,
    "fechaAprobacion" timestamp without time zone,
    metadata jsonb,
    notificado boolean DEFAULT false NOT NULL,
    "fechaNotificacion" timestamp without time zone,
    "intentosRevision" integer DEFAULT 0 NOT NULL,
    "ipUltimoAcceso" character varying(100),
    "dispositivoUltimoAcceso" character varying(255),
    documento_id uuid,
    supervisor_id uuid
);


--
-- Name: tesoreria_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tesoreria_documentos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado public.tesoreria_documentos_estado_enum DEFAULT 'DISPONIBLE'::public.tesoreria_documentos_estado_enum NOT NULL,
    observaciones text,
    "pagoRealizadoPath" character varying,
    "fechaPago" timestamp without time zone,
    "fechaCreacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaActualizacion" timestamp without time zone DEFAULT now() NOT NULL,
    "fechaInicioRevision" timestamp without time zone,
    "fechaFinRevision" timestamp without time zone,
    firma_aplicada boolean DEFAULT false NOT NULL,
    "documentoId" uuid,
    "tesoreroId" uuid NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(100) NOT NULL,
    full_name character varying(100) NOT NULL,
    role public.users_role_enum DEFAULT 'radicador'::public.users_role_enum NOT NULL,
    password character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_email_verified boolean DEFAULT false NOT NULL,
    created_by character varying,
    updated_by character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    two_factor_code character varying,
    two_factor_expires timestamp without time zone,
    two_factor_attempts integer DEFAULT 0 NOT NULL,
    reset_token character varying,
    reset_token_expires timestamp without time zone
);


--
-- Name: proveedores PK_1dcf121f19f362fb1b4c0a493a9; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT "PK_1dcf121f19f362fb1b4c0a493a9" PRIMARY KEY (id);


--
-- Name: documentos PK_30b7ee230a352e7582842d1dc02; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT "PK_30b7ee230a352e7582842d1dc02" PRIMARY KEY (id);


--
-- Name: documentos_contratista PK_32ffbd2279dc99f207accf0b56f; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_contratista
    ADD CONSTRAINT "PK_32ffbd2279dc99f207accf0b56f" PRIMARY KEY (id);


--
-- Name: rendicion_cuentas_historial PK_5a22ba5b91d82eaedf040952482; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rendicion_cuentas_historial
    ADD CONSTRAINT "PK_5a22ba5b91d82eaedf040952482" PRIMARY KEY (id);


--
-- Name: documentos_contrato PK_5ad0116ce7977e1ac0c5f5e63b8; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_contrato
    ADD CONSTRAINT "PK_5ad0116ce7977e1ac0c5f5e63b8" PRIMARY KEY (id);


--
-- Name: contabilidad_documentos PK_9ae4c584abee178829821aad445; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contabilidad_documentos
    ADD CONSTRAINT "PK_9ae4c584abee178829821aad445" PRIMARY KEY (id);


--
-- Name: auditor_documentos PK_9c11aa6a3764b61254d669fc7c9; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditor_documentos
    ADD CONSTRAINT "PK_9c11aa6a3764b61254d669fc7c9" PRIMARY KEY (id);


--
-- Name: rendicion_cuentas_documentos PK_9cba14a77972a044a496d7f520e; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rendicion_cuentas_documentos
    ADD CONSTRAINT "PK_9cba14a77972a044a496d7f520e" PRIMARY KEY (id);


--
-- Name: users PK_a3ffb1c0c8416b9fc6f907b7433; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);


--
-- Name: polizas PK_a8b0ccc8c8d114f91b29285a5bc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT "PK_a8b0ccc8c8d114f91b29285a5bc" PRIMARY KEY (id);


--
-- Name: asesor_gerencia_documentos PK_af53fbabc3a52d4df900f7a454d; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_gerencia_documentos
    ADD CONSTRAINT "PK_af53fbabc3a52d4df900f7a454d" PRIMARY KEY (id);


--
-- Name: modificaciones_contrato PK_b37e5e987a0459bffbadae80b47; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modificaciones_contrato
    ADD CONSTRAINT "PK_b37e5e987a0459bffbadae80b47" PRIMARY KEY (id);


--
-- Name: contratos PK_cfae35069d6f59da899c17ed397; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT "PK_cfae35069d6f59da899c17ed397" PRIMARY KEY (id);


--
-- Name: obligaciones PK_d47d01afc38b9315370c995168f; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligaciones
    ADD CONSTRAINT "PK_d47d01afc38b9315370c995168f" PRIMARY KEY (id);


--
-- Name: supervisor_documentos PK_d4b82186c1973f3265157ceeea4; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_documentos
    ADD CONSTRAINT "PK_d4b82186c1973f3265157ceeea4" PRIMARY KEY (id);


--
-- Name: contratistas PK_d592ac068aa5239ac25c97f2812; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratistas
    ADD CONSTRAINT "PK_d592ac068aa5239ac25c97f2812" PRIMARY KEY (id);


--
-- Name: tesoreria_documentos PK_d97b89f9656b8bfe65907b0c61a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_documentos
    ADD CONSTRAINT "PK_d97b89f9656b8bfe65907b0c61a" PRIMARY KEY (id);


--
-- Name: bitacora_sistema PK_f2d2069630c06378cabe97ebe4a; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_sistema
    ADD CONSTRAINT "PK_f2d2069630c06378cabe97ebe4a" PRIMARY KEY (id);


--
-- Name: signatures PK_f56eb3cd344ce7f9ae28ce814eb; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT "PK_f56eb3cd344ce7f9ae28ce814eb" PRIMARY KEY (id);


--
-- Name: signatures REL_c93e294b75e34b850a599a51e2; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT "REL_c93e294b75e34b850a599a51e2" UNIQUE (user_id);


--
-- Name: proveedores UQ_0b3fe0e7fcaa98c8c2de964effd; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT "UQ_0b3fe0e7fcaa98c8c2de964effd" UNIQUE (numero_identificacion);


--
-- Name: contratos UQ_288b05163da67d313b8facfd122; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT "UQ_288b05163da67d313b8facfd122" UNIQUE (numero_contrato);


--
-- Name: documentos UQ_2f033000b2926dd9b0f9a899cbe; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT "UQ_2f033000b2926dd9b0f9a899cbe" UNIQUE (numero_radicado);


--
-- Name: contratistas UQ_3e8fb08343afcda5d33c2b5bc99; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratistas
    ADD CONSTRAINT "UQ_3e8fb08343afcda5d33c2b5bc99" UNIQUE (documento_identidad);


--
-- Name: documentos UQ_49ab7b2d9154b9844f010164a03; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT "UQ_49ab7b2d9154b9844f010164a03" UNIQUE (token_publico);


--
-- Name: supervisor_documentos UQ_4da1104a449d5e53a62f226c110; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_documentos
    ADD CONSTRAINT "UQ_4da1104a449d5e53a62f226c110" UNIQUE (documento_id, supervisor_id);


--
-- Name: users UQ_97672ac88f789774dd47f7c8be3; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);


--
-- Name: users UQ_fe0bb3f6520ee0469504521e710; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE (username);


--
-- Name: registros_acceso registros_acceso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_acceso
    ADD CONSTRAINT registros_acceso_pkey PRIMARY KEY (id);


--
-- Name: IDX_26a11717c1bc1e8ddce53cbaa9; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_26a11717c1bc1e8ddce53cbaa9" ON public.bitacora_sistema USING btree (documento_id, created_at);


--
-- Name: IDX_54cb449f2b3a7b491f641d231e; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_54cb449f2b3a7b491f641d231e" ON public.supervisor_documentos USING btree ("fechaAprobacion");


--
-- Name: IDX_5926433990173b5da69b46ee10; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_5926433990173b5da69b46ee10" ON public.supervisor_documentos USING btree ("fechaCreacion");


--
-- Name: IDX_62908ddf0bfd328ec6eaa80c0d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_62908ddf0bfd328ec6eaa80c0d" ON public.bitacora_sistema USING btree (usuario_id, created_at);


--
-- Name: IDX_6bbc2db4ae3192654d856b28dd; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_6bbc2db4ae3192654d856b28dd" ON public.supervisor_documentos USING btree (documento_id, estado);


--
-- Name: IDX_9a91c34e15480912085977dfb0; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_9a91c34e15480912085977dfb0" ON public.bitacora_sistema USING btree (accion, created_at);


--
-- Name: IDX_9f531a51f8c4aff9651419430d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_9f531a51f8c4aff9651419430d" ON public.bitacora_sistema USING btree (usuario_id);


--
-- Name: IDX_a17dfc9c4661dee251c98cc388; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_a17dfc9c4661dee251c98cc388" ON public.supervisor_documentos USING btree (supervisor_id, estado);


--
-- Name: IDX_c81a49688bd6cccd823266196b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_c81a49688bd6cccd823266196b" ON public.bitacora_sistema USING btree (modulo, created_at);


--
-- Name: IDX_d1ed8a7cd33a44f8b04a7687aa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_d1ed8a7cd33a44f8b04a7687aa" ON public.bitacora_sistema USING btree (documento_id);


--
-- Name: tesoreria_documentos FK_005ebaaf04384d6212b5608c5be; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_documentos
    ADD CONSTRAINT "FK_005ebaaf04384d6212b5608c5be" FOREIGN KEY ("tesoreroId") REFERENCES public.users(id);


--
-- Name: modificaciones_contrato FK_012c1914d64cb38d93355fac627; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modificaciones_contrato
    ADD CONSTRAINT "FK_012c1914d64cb38d93355fac627" FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: polizas FK_1f611878e2f82ff45d86f71dab8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.polizas
    ADD CONSTRAINT "FK_1f611878e2f82ff45d86f71dab8" FOREIGN KEY (contrato_id) REFERENCES public.contratos(id);


--
-- Name: rendicion_cuentas_historial FK_2109181e2cc12203a790da7a26d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rendicion_cuentas_historial
    ADD CONSTRAINT "FK_2109181e2cc12203a790da7a26d" FOREIGN KEY ("usuarioId") REFERENCES public.users(id);


--
-- Name: auditor_documentos FK_25688fd48438407788a50af136c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditor_documentos
    ADD CONSTRAINT "FK_25688fd48438407788a50af136c" FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: rendicion_cuentas_documentos FK_3487b3cdd4329d6773c1e95050d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rendicion_cuentas_documentos
    ADD CONSTRAINT "FK_3487b3cdd4329d6773c1e95050d" FOREIGN KEY ("documentoId") REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: asesor_gerencia_documentos FK_387a3fe231ae873efb25b7f5172; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_gerencia_documentos
    ADD CONSTRAINT "FK_387a3fe231ae873efb25b7f5172" FOREIGN KEY ("asesorId") REFERENCES public.users(id);


--
-- Name: contabilidad_documentos FK_3ebe07a31c3da8eee46a13b3775; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contabilidad_documentos
    ADD CONSTRAINT "FK_3ebe07a31c3da8eee46a13b3775" FOREIGN KEY (contador_id) REFERENCES public.users(id);


--
-- Name: auditor_documentos FK_6c5c3bef1f267bfae9caecd807f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditor_documentos
    ADD CONSTRAINT "FK_6c5c3bef1f267bfae9caecd807f" FOREIGN KEY (auditor_id) REFERENCES public.users(id);


--
-- Name: documentos FK_737f67a0358cb559977d2e48031; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT "FK_737f67a0358cb559977d2e48031" FOREIGN KEY (radicador_id) REFERENCES public.users(id);


--
-- Name: contratos FK_798b03c73c6cd83b3099aa3a057; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT "FK_798b03c73c6cd83b3099aa3a057" FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: documentos FK_7f806144b9abb3ebbabcbde4c0d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos
    ADD CONSTRAINT "FK_7f806144b9abb3ebbabcbde4c0d" FOREIGN KEY (usuario_asignado_id) REFERENCES public.users(id);


--
-- Name: documentos_contratista FK_8115d1050b29bbd8aa54630fb9e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_contratista
    ADD CONSTRAINT "FK_8115d1050b29bbd8aa54630fb9e" FOREIGN KEY (contratista_id) REFERENCES public.contratistas(id) ON DELETE CASCADE;


--
-- Name: supervisor_documentos FK_8d87c6d06e7def49a488baa3eb1; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_documentos
    ADD CONSTRAINT "FK_8d87c6d06e7def49a488baa3eb1" FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: bitacora_sistema FK_9f531a51f8c4aff9651419430dd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_sistema
    ADD CONSTRAINT "FK_9f531a51f8c4aff9651419430dd" FOREIGN KEY (usuario_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: rendicion_cuentas_documentos FK_a025165185c1d9a9636379ffcb6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rendicion_cuentas_documentos
    ADD CONSTRAINT "FK_a025165185c1d9a9636379ffcb6" FOREIGN KEY ("responsableId") REFERENCES public.users(id);


--
-- Name: documentos_contrato FK_aa17044a801ff295b8817aa517c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_contrato
    ADD CONSTRAINT "FK_aa17044a801ff295b8817aa517c" FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contabilidad_documentos FK_b185403de2ab32da0a9bca1f520; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contabilidad_documentos
    ADD CONSTRAINT "FK_b185403de2ab32da0a9bca1f520" FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: asesor_gerencia_documentos FK_b45c0967c7a608cef55d473a81a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asesor_gerencia_documentos
    ADD CONSTRAINT "FK_b45c0967c7a608cef55d473a81a" FOREIGN KEY ("documentoId") REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: obligaciones FK_bb68511392de83f758ad2652efe; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligaciones
    ADD CONSTRAINT "FK_bb68511392de83f758ad2652efe" FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: signatures FK_c93e294b75e34b850a599a51e2c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT "FK_c93e294b75e34b850a599a51e2c" FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: bitacora_sistema FK_d1ed8a7cd33a44f8b04a7687aa0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitacora_sistema
    ADD CONSTRAINT "FK_d1ed8a7cd33a44f8b04a7687aa0" FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE SET NULL;


--
-- Name: rendicion_cuentas_historial FK_dfd3e4305fde779fab7484bf9cf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rendicion_cuentas_historial
    ADD CONSTRAINT "FK_dfd3e4305fde779fab7484bf9cf" FOREIGN KEY ("documentoId") REFERENCES public.rendicion_cuentas_documentos(id) ON DELETE CASCADE;


--
-- Name: tesoreria_documentos FK_ef22537f5f497a9fb93fedf483b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tesoreria_documentos
    ADD CONSTRAINT "FK_ef22537f5f497a9fb93fedf483b" FOREIGN KEY ("documentoId") REFERENCES public.documentos(id) ON DELETE CASCADE;


--
-- Name: supervisor_documentos FK_f078350f2b5cc373b8601605bce; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_documentos
    ADD CONSTRAINT "FK_f078350f2b5cc373b8601605bce" FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict Yyzwc01094BzRUStYQa3ODxjdm1f18IgGqats6PZhLoRcdHegDggZneuNP5Ad3V

