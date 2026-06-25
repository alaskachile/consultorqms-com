// Catálogo ISO 9001:2015 — contenido PROPIO parafraseado (no es el texto oficial de la norma).
// Cada requisito incluye guía: evidencia esperada, tipo de documento sugerido y criterio de auditoría.

import type { DocumentType } from "@cqms/shared";

export interface SeedRequirement {
  clauseNo: string;
  title: string;
  paraphrasedText: string;
  category: string;
  guidance: {
    expectedEvidence: string;
    suggestedDocumentType: DocumentType | null;
    auditCriteria: string;
  };
}

export const ISO9001: {
  code: string;
  name: string;
  version: string;
  requirements: SeedRequirement[];
} = {
  code: "ISO9001",
  name: "Sistema de gestión de la calidad",
  version: "2015",
  requirements: [
    // 4. Contexto de la organización
    {
      clauseNo: "4.1",
      title: "Comprensión de la organización y su contexto",
      paraphrasedText:
        "La empresa debe identificar los temas internos y externos que afectan su capacidad de lograr los resultados esperados del sistema de calidad.",
      category: "Contexto",
      guidance: {
        expectedEvidence: "Análisis de contexto (p. ej. FODA o PESTEL) con cuestiones internas y externas.",
        suggestedDocumentType: "record",
        auditCriteria: "Existe un análisis vigente y revisado periódicamente de las cuestiones que afectan al sistema.",
      },
    },
    {
      clauseNo: "4.2",
      title: "Necesidades y expectativas de las partes interesadas",
      paraphrasedText:
        "Hay que determinar quiénes son las partes interesadas relevantes y qué requisitos suyos impactan en la calidad.",
      category: "Contexto",
      guidance: {
        expectedEvidence: "Matriz de partes interesadas con sus requisitos y nivel de influencia.",
        suggestedDocumentType: "record",
        auditCriteria: "Las partes interesadas y sus requisitos están identificados y actualizados.",
      },
    },
    {
      clauseNo: "4.3",
      title: "Alcance del sistema de gestión de la calidad",
      paraphrasedText:
        "La empresa debe definir y documentar los límites y la aplicabilidad del sistema, justificando cualquier exclusión.",
      category: "Contexto",
      guidance: {
        expectedEvidence: "Declaración del alcance del QMS disponible como información documentada.",
        suggestedDocumentType: "policy",
        auditCriteria: "El alcance está documentado, es coherente con las actividades y justifica exclusiones.",
      },
    },
    {
      clauseNo: "4.4",
      title: "Sistema de gestión de la calidad y sus procesos",
      paraphrasedText:
        "Se deben establecer los procesos del sistema, sus entradas, salidas, secuencia, interacciones, indicadores y responsables.",
      category: "Contexto",
      guidance: {
        expectedEvidence: "Mapa de procesos y fichas de proceso con interacciones e indicadores.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Los procesos están identificados, interrelacionados y se gestionan con indicadores.",
      },
    },
    // 5. Liderazgo
    {
      clauseNo: "5.1",
      title: "Liderazgo y compromiso",
      paraphrasedText:
        "La alta dirección debe demostrar compromiso activo con el sistema y con el enfoque al cliente.",
      category: "Liderazgo",
      guidance: {
        expectedEvidence: "Actas de revisión por la dirección, comunicaciones internas, asignación de recursos.",
        suggestedDocumentType: "record",
        auditCriteria: "Hay evidencia de participación real de la dirección en el sistema.",
      },
    },
    {
      clauseNo: "5.2",
      title: "Política de la calidad",
      paraphrasedText:
        "Debe existir una política de calidad apropiada al propósito de la empresa, comunicada y disponible.",
      category: "Liderazgo",
      guidance: {
        expectedEvidence: "Política de calidad documentada, difundida y entendida por el personal.",
        suggestedDocumentType: "policy",
        auditCriteria: "La política existe, está comunicada y es coherente con el contexto y objetivos.",
      },
    },
    {
      clauseNo: "5.3",
      title: "Roles, responsabilidades y autoridades",
      paraphrasedText:
        "Las responsabilidades y autoridades relevantes para la calidad deben estar asignadas y comunicadas.",
      category: "Liderazgo",
      guidance: {
        expectedEvidence: "Organigrama y descripciones de puesto o matriz de responsabilidades.",
        suggestedDocumentType: "record",
        auditCriteria: "Cada rol relevante tiene responsabilidades y autoridad definidas y conocidas.",
      },
    },
    // 6. Planificación
    {
      clauseNo: "6.1",
      title: "Acciones para abordar riesgos y oportunidades",
      paraphrasedText:
        "A partir del contexto y las partes interesadas, se deben planificar acciones frente a riesgos y oportunidades.",
      category: "Planificación",
      guidance: {
        expectedEvidence: "Matriz de riesgos y oportunidades con acciones planificadas y seguimiento.",
        suggestedDocumentType: "record",
        auditCriteria: "Los riesgos están evaluados y existen acciones con seguimiento de eficacia.",
      },
    },
    {
      clauseNo: "6.2",
      title: "Objetivos de la calidad y planificación",
      paraphrasedText:
        "Se deben fijar objetivos de calidad medibles, coherentes con la política, y planificar cómo lograrlos.",
      category: "Planificación",
      guidance: {
        expectedEvidence: "Objetivos de calidad con metas, responsables, plazos e indicadores.",
        suggestedDocumentType: "record",
        auditCriteria: "Los objetivos son medibles, tienen plan de logro y se monitorean.",
      },
    },
    {
      clauseNo: "6.3",
      title: "Planificación de los cambios",
      paraphrasedText:
        "Los cambios al sistema deben planificarse de manera controlada, considerando consecuencias y recursos.",
      category: "Planificación",
      guidance: {
        expectedEvidence: "Registro de planificación de cambios relevantes.",
        suggestedDocumentType: "record",
        auditCriteria: "Los cambios significativos se gestionan de forma planificada.",
      },
    },
    // 7. Apoyo
    {
      clauseNo: "7.1",
      title: "Recursos",
      paraphrasedText:
        "La empresa debe proporcionar los recursos necesarios: personas, infraestructura, ambiente y recursos de seguimiento.",
      category: "Apoyo",
      guidance: {
        expectedEvidence: "Inventario de recursos, plan de mantenimiento, calibración de equipos de medición.",
        suggestedDocumentType: "record",
        auditCriteria: "Los recursos necesarios están disponibles y mantenidos.",
      },
    },
    {
      clauseNo: "7.2",
      title: "Competencia",
      paraphrasedText:
        "Debe asegurarse que el personal que afecta la calidad sea competente según educación, formación o experiencia.",
      category: "Apoyo",
      guidance: {
        expectedEvidence: "Matriz de competencias, registros de capacitación y evaluaciones.",
        suggestedDocumentType: "record",
        auditCriteria: "La competencia del personal está definida y demostrada con registros.",
      },
    },
    {
      clauseNo: "7.3",
      title: "Toma de conciencia",
      paraphrasedText:
        "El personal debe conocer la política, los objetivos y su contribución a la eficacia del sistema.",
      category: "Apoyo",
      guidance: {
        expectedEvidence: "Registros de difusión, inducciones, encuestas de conocimiento.",
        suggestedDocumentType: "record",
        auditCriteria: "El personal demuestra conocer su aporte al sistema de calidad.",
      },
    },
    {
      clauseNo: "7.4",
      title: "Comunicación",
      paraphrasedText:
        "Se deben definir las comunicaciones internas y externas pertinentes al sistema: qué, cuándo, a quién y cómo.",
      category: "Apoyo",
      guidance: {
        expectedEvidence: "Plan o matriz de comunicación.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Las comunicaciones relevantes están definidas y se ejecutan.",
      },
    },
    {
      clauseNo: "7.5",
      title: "Información documentada",
      paraphrasedText:
        "El sistema requiere controlar la creación, actualización y resguardo de la información documentada.",
      category: "Apoyo",
      guidance: {
        expectedEvidence: "Procedimiento de control de documentos y registros, con versionado.",
        suggestedDocumentType: "procedure",
        auditCriteria: "La información documentada está controlada, vigente y protegida.",
      },
    },
    // 8. Operación
    {
      clauseNo: "8.1",
      title: "Planificación y control operacional",
      paraphrasedText:
        "Los procesos operativos deben planificarse y controlarse para cumplir los requisitos de productos y servicios.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Planes de producción/servicio, criterios de aceptación, controles operativos.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Los procesos operativos se planifican y controlan según criterios definidos.",
      },
    },
    {
      clauseNo: "8.2",
      title: "Requisitos para productos y servicios",
      paraphrasedText:
        "Hay que determinar y revisar los requisitos del cliente antes de comprometerse a entregar.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Registros de revisión de pedidos/contratos y comunicación con el cliente.",
        suggestedDocumentType: "record",
        auditCriteria: "Los requisitos del cliente se revisan y confirman antes de la entrega.",
      },
    },
    {
      clauseNo: "8.3",
      title: "Diseño y desarrollo",
      paraphrasedText:
        "Cuando aplica, el diseño y desarrollo debe planificarse, controlarse, verificarse y validarse.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Registros de entradas, revisiones, verificación y validación de diseño.",
        suggestedDocumentType: "record",
        auditCriteria: "El proceso de diseño está controlado (o justificadamente excluido).",
      },
    },
    {
      clauseNo: "8.4",
      title: "Control de procesos y productos externos",
      paraphrasedText:
        "Los proveedores y procesos externos deben evaluarse, seleccionarse y controlarse.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Evaluación de proveedores, criterios de selección y reevaluación.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Los proveedores están evaluados y los productos externos controlados.",
      },
    },
    {
      clauseNo: "8.5",
      title: "Producción y provisión del servicio",
      paraphrasedText:
        "La producción y prestación deben realizarse en condiciones controladas, con trazabilidad e identificación.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Instructivos de trabajo, registros de trazabilidad, control de propiedad del cliente.",
        suggestedDocumentType: "procedure",
        auditCriteria: "La provisión se realiza bajo condiciones controladas y trazables.",
      },
    },
    {
      clauseNo: "8.6",
      title: "Liberación de productos y servicios",
      paraphrasedText:
        "Antes de entregar, debe verificarse que se cumplen los requisitos y dejar evidencia de la liberación.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Registros de inspección/liberación con responsable autorizado.",
        suggestedDocumentType: "record",
        auditCriteria: "Existe verificación documentada antes de la entrega.",
      },
    },
    {
      clauseNo: "8.7",
      title: "Control de salidas no conformes",
      paraphrasedText:
        "Los productos o servicios que no cumplen deben identificarse y tratarse para evitar su uso no intencionado.",
      category: "Operación",
      guidance: {
        expectedEvidence: "Procedimiento y registros de tratamiento de no conformes.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Las salidas no conformes se identifican y tratan adecuadamente.",
      },
    },
    // 9. Evaluación del desempeño
    {
      clauseNo: "9.1",
      title: "Seguimiento, medición, análisis y evaluación",
      paraphrasedText:
        "La empresa debe medir el desempeño del sistema, incluida la satisfacción del cliente, y analizar los datos.",
      category: "Evaluación",
      guidance: {
        expectedEvidence: "Indicadores, medición de satisfacción del cliente, análisis de datos.",
        suggestedDocumentType: "record",
        auditCriteria: "Se mide el desempeño y se analizan los resultados para tomar decisiones.",
      },
    },
    {
      clauseNo: "9.2",
      title: "Auditoría interna",
      paraphrasedText:
        "Deben realizarse auditorías internas planificadas para verificar la conformidad y eficacia del sistema.",
      category: "Evaluación",
      guidance: {
        expectedEvidence: "Programa de auditorías, informes y seguimiento de hallazgos.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Hay un programa de auditoría interna ejecutado con hallazgos gestionados.",
      },
    },
    {
      clauseNo: "9.3",
      title: "Revisión por la dirección",
      paraphrasedText:
        "La alta dirección debe revisar el sistema a intervalos planificados para asegurar su adecuación y eficacia.",
      category: "Evaluación",
      guidance: {
        expectedEvidence: "Actas de revisión por la dirección con entradas y salidas definidas.",
        suggestedDocumentType: "record",
        auditCriteria: "La revisión por la dirección se realiza y genera decisiones y acciones.",
      },
    },
    // 10. Mejora
    {
      clauseNo: "10.1",
      title: "Mejora — generalidades",
      paraphrasedText:
        "La empresa debe identificar oportunidades de mejora para satisfacer requisitos y aumentar la satisfacción.",
      category: "Mejora",
      guidance: {
        expectedEvidence: "Registros de iniciativas de mejora.",
        suggestedDocumentType: "record",
        auditCriteria: "Existen acciones de mejora identificadas e implementadas.",
      },
    },
    {
      clauseNo: "10.2",
      title: "No conformidad y acción correctiva",
      paraphrasedText:
        "Ante una no conformidad, debe reaccionarse, analizar la causa raíz y aplicar acciones correctivas eficaces.",
      category: "Mejora",
      guidance: {
        expectedEvidence: "Registros de no conformidades con análisis de causa y acciones correctivas.",
        suggestedDocumentType: "procedure",
        auditCriteria: "Las no conformidades se tratan con análisis de causa y verificación de eficacia.",
      },
    },
    {
      clauseNo: "10.3",
      title: "Mejora continua",
      paraphrasedText:
        "La empresa debe mejorar continuamente la conveniencia, adecuación y eficacia del sistema.",
      category: "Mejora",
      guidance: {
        expectedEvidence: "Evidencia de mejora sostenida del desempeño en el tiempo.",
        suggestedDocumentType: "record",
        auditCriteria: "Se demuestra mejora continua a partir del análisis y las revisiones.",
      },
    },
  ],
};
