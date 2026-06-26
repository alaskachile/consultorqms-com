import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>ConsultorQMS</h1>
      <p>QMS guiado por IA para preparar auditorías ISO.</p>
      <p>
        <Link href="/projects" style={{ color: "#7cc4ff" }}>
          Ir al dashboard de proyectos →
        </Link>
      </p>
      <p>
        <Link href="/requirements" style={{ color: "#7cc4ff" }}>
          Ver catálogo de requisitos ISO 9001 →
        </Link>
      </p>
    </main>
  );
}
