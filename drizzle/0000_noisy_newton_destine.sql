CREATE TYPE "public"."entidade_comentario" AS ENUM('projeto', 'ordem_servico', 'cliente', 'usina');--> statement-breakpoint
CREATE TYPE "public"."fabricante_portal" AS ENUM('growatt', 'hoymiles', 'solis', 'foxess', 'huawei', 'solarportal_plus', 'nep', 'outro');--> statement-breakpoint
CREATE TYPE "public"."granularidade_leitura" AS ENUM('dia', 'mes', 'ano');--> statement-breakpoint
CREATE TYPE "public"."origem_os" AS ENUM('manual', 'alerta', 'cliente');--> statement-breakpoint
CREATE TYPE "public"."papel_usuario" AS ENUM('adm', 'vendedor', 'engenheiro', 'tecnico', 'estoque');--> statement-breakpoint
CREATE TYPE "public"."prioridade_os" AS ENUM('baixa', 'normal', 'alta', 'urgente');--> statement-breakpoint
CREATE TYPE "public"."severidade_alerta" AS ENUM('info', 'atencao', 'critico');--> statement-breakpoint
CREATE TYPE "public"."situacao_projeto" AS ENUM('em_andamento', 'concluido', 'cancelado', 'pausado');--> statement-breakpoint
CREATE TYPE "public"."status_alerta" AS ENUM('aberto', 'reconhecido', 'resolvido');--> statement-breakpoint
CREATE TYPE "public"."status_os" AS ENUM('aberta', 'agendada', 'em_andamento', 'aguardando_peca', 'concluida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_usina" AS ENUM('em_implantacao', 'gerando', 'inativa');--> statement-breakpoint
CREATE TYPE "public"."tipo_alerta" AS ENUM('offline', 'sem_comunicacao', 'geracao_baixa', 'alarme_inversor');--> statement-breakpoint
CREATE TYPE "public"."tipo_equipamento" AS ENUM('inversor', 'microinversor', 'modulo', 'datalogger', 'bateria', 'medidor');--> statement-breakpoint
CREATE TYPE "public"."tipo_os" AS ENUM('instalacao', 'preventiva', 'corretiva', 'limpeza', 'garantia', 'vistoria');--> statement-breakpoint
CREATE TYPE "public"."tipo_pessoa" AS ENUM('pf', 'pj');--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" "tipo_pessoa" DEFAULT 'pf' NOT NULL,
	"nome" text NOT NULL,
	"cpf_cnpj" varchar(14),
	"email" text,
	"telefone" varchar(20),
	"cep" varchar(8),
	"logradouro" text,
	"numero" varchar(20),
	"complemento" text,
	"bairro" text,
	"cidade" text,
	"uf" varchar(2),
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conta_portal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fabricante" "fabricante_portal" NOT NULL,
	"apelido" text NOT NULL,
	"credenciais_cifradas" text,
	"ativa" boolean DEFAULT true NOT NULL,
	"cadencia_minutos" integer DEFAULT 15 NOT NULL,
	"chamadas_dia_max" integer,
	"ultima_coleta_em" timestamp with time zone,
	"ultimo_erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" varchar(14),
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usina_id" uuid NOT NULL,
	"tipo" "tipo_equipamento" NOT NULL,
	"fabricante" text,
	"modelo" text,
	"numero_serie" varchar(60),
	"quantidade" integer DEFAULT 1 NOT NULL,
	"potencia_w" numeric(12, 2),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessao" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unidade_consumidora" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"numero_instalacao" varchar(30) NOT NULL,
	"concessionaria" text NOT NULL,
	"titular" text,
	"classe" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usina" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"unidade_consumidora_id" uuid,
	"nome" text NOT NULL,
	"potencia_kwp" numeric(10, 3),
	"data_instalacao" timestamp,
	"status" "status_usina" DEFAULT 'em_implantacao' NOT NULL,
	"cidade" text,
	"uf" varchar(2),
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" "papel_usuario" DEFAULT 'vendedor' NOT NULL,
	"telefone" varchar(20),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vinculo_portal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usina_id" uuid NOT NULL,
	"conta_portal_id" uuid NOT NULL,
	"id_externo" varchar(60) NOT NULL,
	"nome_externo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comentario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"entidade" "entidade_comentario" NOT NULL,
	"entidade_id" uuid NOT NULL,
	"autor_id" uuid,
	"texto" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "etapa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"slug" varchar(40) NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer NOT NULL,
	"descricao" text,
	"papel_responsavel" "papel_usuario",
	"prazo_padrao_dias" integer,
	"terminal" boolean DEFAULT false NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ordem_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"cliente_id" uuid NOT NULL,
	"usina_id" uuid,
	"tipo" "tipo_os" NOT NULL,
	"status" "status_os" DEFAULT 'aberta' NOT NULL,
	"prioridade" "prioridade_os" DEFAULT 'normal' NOT NULL,
	"origem" "origem_os" DEFAULT 'manual' NOT NULL,
	"descricao" text NOT NULL,
	"responsavel_id" uuid,
	"aberta_por_id" uuid,
	"agendada_para" timestamp,
	"prazo_sla" timestamp,
	"iniciada_em" timestamp with time zone,
	"concluida_em" timestamp with time zone,
	"laudo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os_anexo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"categoria" text DEFAULT 'foto' NOT NULL,
	"caminho" text NOT NULL,
	"nome_original" text,
	"tamanho_bytes" integer,
	"enviado_por_id" uuid,
	"capturado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os_checklist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"ordem_servico_id" uuid NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"descricao" text NOT NULL,
	"obrigatorio" boolean DEFAULT false NOT NULL,
	"concluido" boolean DEFAULT false NOT NULL,
	"observacao" text,
	"concluido_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projeto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"usina_id" uuid,
	"titulo" text NOT NULL,
	"etapa_id" uuid NOT NULL,
	"situacao" "situacao_projeto" DEFAULT 'em_andamento' NOT NULL,
	"responsavel_id" uuid,
	"prazo_etapa" timestamp,
	"etapa_desde" timestamp with time zone DEFAULT now() NOT NULL,
	"valor" numeric(12, 2),
	"potencia_kwp" numeric(10, 3),
	"protocolo_concessionaria" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projeto_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"projeto_id" uuid NOT NULL,
	"etapa_de_id" uuid,
	"etapa_para_id" uuid NOT NULL,
	"horas_na_etapa_anterior" integer,
	"usuario_id" uuid,
	"observacao" text,
	"ocorrido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usina_id" uuid NOT NULL,
	"tipo" "tipo_alerta" NOT NULL,
	"severidade" "severidade_alerta" DEFAULT 'atencao' NOT NULL,
	"status" "status_alerta" DEFAULT 'aberto' NOT NULL,
	"mensagem" text NOT NULL,
	"codigo_fabricante" varchar(40),
	"ordem_servico_id" uuid,
	"reconhecido_por_id" uuid,
	"aberto_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvido_em" timestamp with time zone,
	"notificado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leitura" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usina_id" uuid NOT NULL,
	"equipamento_id" uuid,
	"medido_em" timestamp with time zone NOT NULL,
	"granularidade" "granularidade_leitura" DEFAULT 'dia' NOT NULL,
	"potencia_w" numeric(12, 2),
	"energia_kwh" numeric(12, 3),
	"energia_total_kwh" numeric(14, 3),
	"status_bruto" varchar(40),
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leitura_bruta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usina_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"destinatario_id" uuid,
	"telefone" varchar(20),
	"template" text NOT NULL,
	"parametros" text,
	"status" varchar(20) DEFAULT 'pendente' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"erro" text,
	"enviada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tarifa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"concessionaria" text NOT NULL,
	"uf" varchar(2),
	"valor_kwh" numeric(10, 6) NOT NULL,
	"vigencia_inicio" timestamp NOT NULL,
	"vigencia_fim" timestamp,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta_portal" ADD CONSTRAINT "conta_portal_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipamento" ADD CONSTRAINT "equipamento_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipamento" ADD CONSTRAINT "equipamento_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unidade_consumidora" ADD CONSTRAINT "unidade_consumidora_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unidade_consumidora" ADD CONSTRAINT "unidade_consumidora_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usina" ADD CONSTRAINT "usina_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usina" ADD CONSTRAINT "usina_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usina" ADD CONSTRAINT "usina_unidade_consumidora_id_unidade_consumidora_id_fk" FOREIGN KEY ("unidade_consumidora_id") REFERENCES "public"."unidade_consumidora"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_portal" ADD CONSTRAINT "vinculo_portal_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_portal" ADD CONSTRAINT "vinculo_portal_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_portal" ADD CONSTRAINT "vinculo_portal_conta_portal_id_conta_portal_id_fk" FOREIGN KEY ("conta_portal_id") REFERENCES "public"."conta_portal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comentario" ADD CONSTRAINT "comentario_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comentario" ADD CONSTRAINT "comentario_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etapa" ADD CONSTRAINT "etapa_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_aberta_por_id_usuario_id_fk" FOREIGN KEY ("aberta_por_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_anexo" ADD CONSTRAINT "os_anexo_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_anexo" ADD CONSTRAINT "os_anexo_ordem_servico_id_ordem_servico_id_fk" FOREIGN KEY ("ordem_servico_id") REFERENCES "public"."ordem_servico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_anexo" ADD CONSTRAINT "os_anexo_enviado_por_id_usuario_id_fk" FOREIGN KEY ("enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_checklist_item" ADD CONSTRAINT "os_checklist_item_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_checklist_item" ADD CONSTRAINT "os_checklist_item_ordem_servico_id_ordem_servico_id_fk" FOREIGN KEY ("ordem_servico_id") REFERENCES "public"."ordem_servico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_etapa_id_etapa_id_fk" FOREIGN KEY ("etapa_id") REFERENCES "public"."etapa"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_responsavel_id_usuario_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto_evento" ADD CONSTRAINT "projeto_evento_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto_evento" ADD CONSTRAINT "projeto_evento_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto_evento" ADD CONSTRAINT "projeto_evento_etapa_de_id_etapa_id_fk" FOREIGN KEY ("etapa_de_id") REFERENCES "public"."etapa"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto_evento" ADD CONSTRAINT "projeto_evento_etapa_para_id_etapa_id_fk" FOREIGN KEY ("etapa_para_id") REFERENCES "public"."etapa"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projeto_evento" ADD CONSTRAINT "projeto_evento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_ordem_servico_id_ordem_servico_id_fk" FOREIGN KEY ("ordem_servico_id") REFERENCES "public"."ordem_servico"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_reconhecido_por_id_usuario_id_fk" FOREIGN KEY ("reconhecido_por_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leitura" ADD CONSTRAINT "leitura_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leitura" ADD CONSTRAINT "leitura_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leitura" ADD CONSTRAINT "leitura_equipamento_id_equipamento_id_fk" FOREIGN KEY ("equipamento_id") REFERENCES "public"."equipamento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leitura_bruta" ADD CONSTRAINT "leitura_bruta_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leitura_bruta" ADD CONSTRAINT "leitura_bruta_usina_id_usina_id_fk" FOREIGN KEY ("usina_id") REFERENCES "public"."usina"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_destinatario_id_usuario_id_fk" FOREIGN KEY ("destinatario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarifa" ADD CONSTRAINT "tarifa_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cliente_empresa_idx" ON "cliente" USING btree ("empresa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_doc_uq" ON "cliente" USING btree ("empresa_id","cpf_cnpj");--> statement-breakpoint
CREATE INDEX "cliente_nome_idx" ON "cliente" USING btree ("empresa_id","nome");--> statement-breakpoint
CREATE INDEX "conta_portal_empresa_idx" ON "conta_portal" USING btree ("empresa_id","fabricante");--> statement-breakpoint
CREATE INDEX "equipamento_usina_idx" ON "equipamento" USING btree ("usina_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipamento_sn_uq" ON "equipamento" USING btree ("empresa_id","numero_serie");--> statement-breakpoint
CREATE INDEX "sessao_usuario_idx" ON "sessao" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "uc_empresa_idx" ON "unidade_consumidora" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "uc_cliente_idx" ON "unidade_consumidora" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uc_instalacao_uq" ON "unidade_consumidora" USING btree ("empresa_id","concessionaria","numero_instalacao");--> statement-breakpoint
CREATE INDEX "usina_empresa_idx" ON "usina" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "usina_cliente_idx" ON "usina" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "usina_status_idx" ON "usina" USING btree ("empresa_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_email_uq" ON "usuario" USING btree ("email");--> statement-breakpoint
CREATE INDEX "usuario_empresa_idx" ON "usuario" USING btree ("empresa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vinculo_portal_uq" ON "vinculo_portal" USING btree ("conta_portal_id","id_externo");--> statement-breakpoint
CREATE INDEX "vinculo_portal_usina_idx" ON "vinculo_portal" USING btree ("usina_id");--> statement-breakpoint
CREATE INDEX "comentario_entidade_idx" ON "comentario" USING btree ("empresa_id","entidade","entidade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "etapa_slug_uq" ON "etapa" USING btree ("empresa_id","slug");--> statement-breakpoint
CREATE INDEX "etapa_ordem_idx" ON "etapa" USING btree ("empresa_id","ordem");--> statement-breakpoint
CREATE INDEX "os_empresa_status_idx" ON "ordem_servico" USING btree ("empresa_id","status");--> statement-breakpoint
CREATE INDEX "os_responsavel_idx" ON "ordem_servico" USING btree ("responsavel_id","status");--> statement-breakpoint
CREATE INDEX "os_usina_idx" ON "ordem_servico" USING btree ("usina_id");--> statement-breakpoint
CREATE INDEX "os_numero_idx" ON "ordem_servico" USING btree ("empresa_id","numero");--> statement-breakpoint
CREATE INDEX "os_anexo_os_idx" ON "os_anexo" USING btree ("ordem_servico_id");--> statement-breakpoint
CREATE INDEX "os_checklist_os_idx" ON "os_checklist_item" USING btree ("ordem_servico_id","ordem");--> statement-breakpoint
CREATE INDEX "projeto_empresa_etapa_idx" ON "projeto" USING btree ("empresa_id","etapa_id");--> statement-breakpoint
CREATE INDEX "projeto_situacao_idx" ON "projeto" USING btree ("empresa_id","situacao");--> statement-breakpoint
CREATE INDEX "projeto_responsavel_idx" ON "projeto" USING btree ("responsavel_id");--> statement-breakpoint
CREATE INDEX "projeto_prazo_idx" ON "projeto" USING btree ("empresa_id","prazo_etapa");--> statement-breakpoint
CREATE INDEX "projeto_evento_projeto_idx" ON "projeto_evento" USING btree ("projeto_id","ocorrido_em");--> statement-breakpoint
CREATE INDEX "alerta_empresa_status_idx" ON "alerta" USING btree ("empresa_id","status");--> statement-breakpoint
CREATE INDEX "alerta_usina_idx" ON "alerta" USING btree ("usina_id","tipo","status");--> statement-breakpoint
CREATE UNIQUE INDEX "alerta_evento_uq" ON "alerta" USING btree ("usina_id","tipo","codigo_fabricante","aberto_em") WHERE "alerta"."codigo_fabricante" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "alerta_regra_uq" ON "alerta" USING btree ("usina_id","tipo","aberto_em") WHERE "alerta"."codigo_fabricante" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "leitura_equipamento_instante_uq" ON "leitura" USING btree ("equipamento_id","medido_em","granularidade");--> statement-breakpoint
CREATE UNIQUE INDEX "leitura_usina_instante_uq" ON "leitura" USING btree ("usina_id","medido_em","granularidade") WHERE "leitura"."equipamento_id" is null;--> statement-breakpoint
CREATE INDEX "leitura_usina_tempo_idx" ON "leitura" USING btree ("usina_id","granularidade","medido_em");--> statement-breakpoint
CREATE INDEX "leitura_bruta_usina_idx" ON "leitura_bruta" USING btree ("usina_id","coletado_em");--> statement-breakpoint
CREATE INDEX "notificacao_pendente_idx" ON "notificacao" USING btree ("status","criado_em");--> statement-breakpoint
CREATE INDEX "tarifa_lookup_idx" ON "tarifa" USING btree ("empresa_id","concessionaria","vigencia_inicio");