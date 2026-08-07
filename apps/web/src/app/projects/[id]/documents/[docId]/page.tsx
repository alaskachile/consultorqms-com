import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrgId } from "@/lib/org";

// Se consulta en cada request (la Data API no está disponible en build time).
export const dynamic = "force-dynamic";

const DOC_TYPE_LABEL: Record<string, string> = {
  policy: "Política",
  procedure: "Procedimiento",
  record: "Registro",
  manual: "Manual",
  other: "Documento",
};

const DOC_STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Borrador", color: "#eab308" },
  in_review: { label: "En revisión", color: "#7cc4ff" },
  approved: { label: "Aprobado", color: "#22c55e" },
};

const ORIGIN_LABEL: Record<string, string> = {
  generated: "Generado por IA",
  uploaded: "Subido",
};

export default async function DocumentDetailPage({
  params,
}: {
  params: { id: string; docId: string };
}) {
  const orgId = await getOrgId();

  // Blindaje por URL (multi-tenant): el documento se busca por id + project_id +
  // el `org_id` de la sesión. Con eso la pertenencia del proyecto queda implícita
  // (documents.org_id es el de su proyecto): un doc de otro tenant, o de otro
  // proyecto, no devuelve fila → notFound().
  const [doc] = await db
    .select({
      id: schema.documents.id,
      type: schema.documents.type,
      title: schema.documents.title,
      status: schema.documents.status,
      origin: schema.documents.origin,
      currentVersionId: schema.documents.currentVersionId,
      clauseNo: schema.requirements.clauseNo,
      clauseTitle: schema.requirements.title,
    })
    .from(schema.documents)
    .leftJoin(schema.requirements, eq(schema.documents.requirementId, schema.requirements.id))
    .where(
      and(
        eq(schema.documents.id, params.docId),
        eq(schema.documents.projectId, params.id),
        eq(schema.documents.orgId, orgId),
      ),
    )
    .limit(1);

  if (!doc) notFound();

  // Contenido de la versión actual (o la primera, como respaldo).
  let contentMd: string | null = null;
  let versionNo: number | null = null;
  if (doc.currentVersionId) {
    const [version] = await db
      .select({ contentMd: schema.documentVersions.contentMd, versionNo: schema.documentVersions.versionNo })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, doc.currentVersionId))
      .limit(1);
    contentMd = version?.contentMd ?? null;
    versionNo = version?.versionNo ?? null;
  }

  const statusMeta = DOC_STATUS_META[doc.status] ?? { label: doc.status, color: "#94a3b8" };

  return (
    <main style={{ maxWidth: 800 }}>
      <p>
        <Link href={`/projects/${params.id}/documents`} style={{ color: "#7cc4ff" }}>
          ← Volver a documentos
        </Link>
      </p>

      <h1 style={{ marginBottom: "0.35rem" }}>{doc.title}</h1>
      <div style={{ opacity: 0.65, fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        {DOC_TYPE_LABEL[doc.type] ?? doc.type}
        {doc.clauseNo && (
          <>
            {" · "}Cláusula {doc.clauseNo}
            {doc.clauseTitle ? ` — ${doc.clauseTitle}` : ""}
          </>
        )}{" "}
        · {ORIGIN_LABEL[doc.origin] ?? doc.origin}
        {versionNo != null && <> · v{versionNo}</>} ·{" "}
        <span style={{ color: statusMeta.color, fontWeight: 600 }}>{statusMeta.label}</span>
      </div>

      <article
        style={{
          padding: "1.75rem 2rem",
          background: "#0f1626",
          border: "1px solid #1f2a44",
          borderRadius: 10,
          lineHeight: 1.65,
        }}
      >
        {contentMd ? (
          renderMarkdown(contentMd)
        ) : (
          <p style={{ opacity: 0.5 }}>Este documento todavía no tiene contenido.</p>
        )}
      </article>
    </main>
  );
}

/**
 * Renderizador de markdown mínimo y sin dependencias, seguro (produce nodos React,
 * sin `dangerouslySetInnerHTML`). Cubre lo que genera el agente: títulos, listas
 * (con viñeta y numeradas), negrita/itálica en línea y párrafos. No pretende ser
 * un renderer completo — alcanza para mostrar el borrador de forma legible hasta
 * que haya un editor rico.
 */
function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={key++} style={{ paddingLeft: "1.4rem", margin: "0.5rem 0" }}>
          {items}
        </ol>
      ) : (
        <ul key={key++} style={{ paddingLeft: "1.4rem", margin: "0.5rem 0" }}>
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const level = heading[1]?.length ?? 1;
      const text = renderInline(heading[2] ?? "");
      const sizes = ["1.6rem", "1.35rem", "1.15rem", "1.02rem", "0.95rem", "0.9rem"];
      blocks.push(
        <p
          key={key++}
          style={{ fontWeight: 700, fontSize: sizes[level - 1] ?? "0.95rem", margin: level <= 2 ? "1.2rem 0 0.5rem" : "0.9rem 0 0.35rem" }}
        >
          {text}
        </p>,
      );
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1] ?? "");
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1] ?? "");
      continue;
    }

    // Párrafo normal.
    flushList();
    blocks.push(
      <p key={key++} style={{ margin: "0.5rem 0" }}>
        {renderInline(line)}
      </p>,
    );
  }

  flushList();
  return <>{blocks}</>;
}

/** Negrita (**x** / __x__) e itálica (*x* / _x_) en línea, sin HTML crudo. */
function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] != null) {
      nodes.push(<strong key={key++}>{m[2]}</strong>);
    } else if (m[4] != null) {
      nodes.push(<em key={key++}>{m[4]}</em>);
    }
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);

  return nodes;
}
