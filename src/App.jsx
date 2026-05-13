
import { useState, useMemo, useRef, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

// ─── PALETA Y ESTILOS GLOBALES ─────────────────────────────────────────────
const RISK_CONFIG = {
  critico:     { label: "Crítico",      bg: "bg-red-900/40",    border: "border-red-500",    text: "text-red-400",    dot: "bg-red-500"    },
  alto:        { label: "Alto",         bg: "bg-orange-900/40", border: "border-orange-500", text: "text-orange-400", dot: "bg-orange-500" },
  medio:       { label: "Medio",        bg: "bg-yellow-900/40", border: "border-yellow-500", text: "text-yellow-400", dot: "bg-yellow-400" },
  bajo:        { label: "Bajo",         bg: "bg-emerald-900/40",border: "border-emerald-500",text: "text-emerald-400",dot: "bg-emerald-500"},
  no_evaluado: { label: "No evaluado",  bg: "bg-slate-800/60",  border: "border-slate-600",  text: "text-slate-400",  dot: "bg-slate-500"  },
};

const STATUS_CONFIG = {
  activo:       { label: "Activo",       color: "text-emerald-400 bg-emerald-900/30 border-emerald-700" },
  inasistente:  { label: "Inasistente",  color: "text-yellow-400 bg-yellow-900/30 border-yellow-700"   },
  abandono:     { label: "Abandono",     color: "text-red-400 bg-red-900/30 border-red-700"            },
  alta:         { label: "Alta",         color: "text-sky-400 bg-sky-900/30 border-sky-700"            },
  derivado:     { label: "Derivado",     color: "text-violet-400 bg-violet-900/30 border-violet-700"   },
  hospitalizado:{ label: "Hospitalizado",color: "text-orange-400 bg-orange-900/30 border-orange-700"   },
};


// ─── INSTITUCIONES / ESPACIOS DE TRABAJO ─────────────────────────────────
const INSTITUTIONS = [
  {
    id: "centro_medico",
    label: "Centro Médico",
    short: "Centro",
    icon: "🏥",
    tone: "sky",
    description: "Pacientes y colegas gestionados en consulta ambulatoria / centro médico.",
  },
  {
    id: "hospital",
    label: "Hospital",
    short: "Hospital",
    icon: "🏨",
    tone: "violet",
    description: "Pacientes, equipo y coordinación asociados al hospital.",
  },
];

let ACTIVE_INSTITUTION_ID = "centro_medico";
let ACTIVE_USER_ID = "admin";
let USING_SUPABASE_DATA = false;
let ACCESSIBLE_INSTITUTIONS = [...INSTITUTIONS];
let ACTIVE_MEMBERSHIPS_BY_INSTITUTION = {};

const slugifyWorkspaceId = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const normalizeWorkspaceId = (institution) => {
  const raw = institution?.slug || institution?.kind || institution?.id || institution || "";
  const id = slugifyWorkspaceId(raw);
  if (["centro_medico", "centromedico", "centro_medico_demo"].includes(id)) return "centro_medico";
  if (id === "centro_medico") return "centro_medico";
  if (id === "hospital") return "hospital";
  return id || "centro_medico";
};
const workspaceToInstitutionSlug = (workspaceId) => workspaceId === "centro_medico" ? "centro-medico" : String(workspaceId || "").replaceAll("_", "-");
const getAccessibleInstitutions = () => ACCESSIBLE_INSTITUTIONS?.length ? ACCESSIBLE_INSTITUTIONS : INSTITUTIONS;
const getInstitution = (id) => getAccessibleInstitutions().find(i => i.id === id) || INSTITUTIONS.find(i => i.id === id) || {
  id,
  label: String(id || "Institución").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()),
  short: String(id || "Inst").slice(0, 12),
  icon: "🏥",
  tone: "sky",
  description: "Institución clínica configurada en Supabase.",
};
const setAccessibleInstitutionsFromMemberships = (memberships = []) => {
  const seen = new Set();
  const items = memberships.map(m => m.institutionUi).filter(Boolean).filter(inst => {
    if (seen.has(inst.id)) return false;
    seen.add(inst.id);
    return true;
  });
  ACCESSIBLE_INSTITUTIONS = items.length ? items : [...INSTITUTIONS];
  ACTIVE_MEMBERSHIPS_BY_INSTITUTION = memberships.reduce((acc, m) => {
    acc[m.institution] = m;
    return acc;
  }, {});
};
const getMembershipForWorkspace = (workspaceId) => ACTIVE_MEMBERSHIPS_BY_INSTITUTION?.[workspaceId] || null;
const getAppUserIdForWorkspace = (workspaceId, fallback = "admin") => {
  const membership = getMembershipForWorkspace(workspaceId);
  if (!membership) return fallback;
  return membership.role === "admin" ? "admin" : (membership.professionalId || fallback);
};
const normalizeRoleForApp = (role) => role === "terapeuta_ocupacional" ? "terapeuta" : role;


// ─── LOGIN REAL / MAPEO DE USUARIOS ───────────────────────────────────────
// En modo demo sin base real, este mapa conecta email con perfil de app.
// En Etapa 5 la app intenta leer la tabla public.profiles de Supabase
// y usa este mapa solo como respaldo temporal mientras carga.
const AUTH_PROFILE_BY_EMAIL = {
  "admin@clincoord.demo": { appUserId: "admin", institution: "centro_medico", label: "Administrador/a general" },
  "valentina@clincoord.demo": { appUserId: "p1", institution: "centro_medico", label: "Dra. Valentina Rojas" },
  "andres@clincoord.demo": { appUserId: "p2", institution: "centro_medico", label: "Dr. Andrés Méndez" },
  "camila@clincoord.demo": { appUserId: "p3", institution: "centro_medico", label: "Dra. Camila Fuentes" },
  "roberto@clincoord.demo": { appUserId: "p4", institution: "centro_medico", label: "Ps. Roberto Sánchez" },
  "h-admin@clincoord.demo": { appUserId: "admin", institution: "hospital", label: "Administrador/a Hospital" },
  "h-valentina@clincoord.demo": { appUserId: "p1_h", institution: "hospital", label: "Dra. Valentina Rojas · Hospital" },
  "h-andres@clincoord.demo": { appUserId: "p2_h", institution: "hospital", label: "Dr. Andrés Méndez · Hospital" },
};

const getAuthProfileFromEmail = (email) => {
  const clean = (email || "").trim().toLowerCase();
  return AUTH_PROFILE_BY_EMAIL[clean] || { appUserId: "admin", institution: "centro_medico", label: clean || "Usuario autenticado" };
};

// ─── DATOS MOCK ────────────────────────────────────────────────────────────
const RAW_PROFESSIONALS = [
  { id:"p1", name:"Dra. Valentina Rojas",    role:"psiquiatra_jefe", specialty:"Psiquiatría Adultos",       patients:4, initials:"VR", color:"bg-violet-600" },
  { id:"p2", name:"Dr. Andrés Méndez",       role:"psiquiatra",      specialty:"Psiquiatría Adultos",       patients:3, initials:"AM", color:"bg-sky-600"    },
  { id:"p3", name:"Dra. Camila Fuentes",     role:"medico_general",  specialty:"Medicina General/SM",       patients:2, initials:"CF", color:"bg-teal-600"   },
  { id:"p4", name:"Ps. Roberto Sánchez",     role:"psicologo",       specialty:"Psicología Clínica",        patients:5, initials:"RS", color:"bg-indigo-600" },
  { id:"p5", name:"Ps. Andrea Leal",         role:"psicologo",       specialty:"Neuropsicología",           patients:3, initials:"AL", color:"bg-pink-600"   },
  { id:"p6", name:"T.O. Marcela Ibáñez",     role:"terapeuta",       specialty:"Terapia Ocupacional",       patients:6, initials:"MI", color:"bg-amber-600"  },
  { id:"p7", name:"EU. Jorge Pinto",         role:"enfermero",       specialty:"Enfermería Salud Mental",   patients:8, initials:"JP", color:"bg-cyan-600"   },
  { id:"p8", name:"T.S. Patricia Vergara",   role:"trabajador_social",specialty:"Trabajo Social",           patients:5, initials:"PV", color:"bg-rose-600"   },
];

const RAW_MEDICATIONS = [
  { id:"m1", drug:"Quetiapina",    dose:"200 mg",  scheme:"0-0-1",  freq:"Nocturno",   startDate:"2024-03-01", lastAdj:"2024-08-15", prescriber:"p1", nextControl:"2024-10-15", followup:"Control metabólico en 1 mes" },
  { id:"m2", drug:"Sertralina",    dose:"100 mg",  scheme:"1-0-0",  freq:"Matutino",   startDate:"2024-05-10", lastAdj:"2024-09-01", prescriber:"p2", nextControl:"2024-11-01", followup:"Evaluar respuesta" },
  { id:"m3", drug:"Litio",         dose:"600 mg",  scheme:"1-0-1",  freq:"Cada 12h",   startDate:"2023-11-20", lastAdj:"2024-07-20", prescriber:"p1", nextControl:"2024-10-05", followup:"Litemia pendiente ⚠" },
  { id:"m4", drug:"Clozapina",     dose:"150 mg",  scheme:"0-0-1",  freq:"Nocturno",   startDate:"2023-06-01", lastAdj:"2024-06-01", prescriber:"p1", nextControl:"2024-10-01", followup:"Hemograma mensual obligatorio" },
  { id:"m5", drug:"Risperidona LAI",dose:"37.5 mg",scheme:"IM/14d", freq:"Cada 14 días",startDate:"2024-01-15",lastAdj:"2024-09-15",prescriber:"p2",nextControl:"2024-10-29", followup:"Próxima inyección 29 oct" },
  { id:"m6", drug:"Ácido Valproico",dose:"500 mg", scheme:"1-0-1",  freq:"Cada 12h",   startDate:"2024-02-28", lastAdj:"2024-08-28", prescriber:"p1", nextControl:"2024-10-28", followup:"Valproemia en próximo control" },
  { id:"m7", drug:"Lorazepam",     dose:"1 mg",    scheme:"0-0-1",  freq:"SOS nocturno",startDate:"2024-07-01",lastAdj:"2024-09-01", prescriber:"p3", nextControl:"2024-10-10", followup:"Benzodiacepina >3 meses ⚠" },
  { id:"m8", drug:"Bupropión",     dose:"150 mg",  scheme:"1-0-0",  freq:"Matutino",   startDate:"2024-06-15", lastAdj:"2024-09-15", prescriber:"p2", nextControl:"2024-11-15", followup:"Monitorear PA" },
  { id:"m9", drug:"Aripiprazol",   dose:"15 mg",   scheme:"1-0-0",  freq:"Matutino",   startDate:"2024-04-01", lastAdj:"2024-09-01", prescriber:"p1", nextControl:"2024-11-01", followup:"Control metabólico" },
  { id:"m10",drug:"Clonazepam",    dose:"0.5 mg",  scheme:"0-0-1",  freq:"Nocturno",   startDate:"2024-08-01", lastAdj:"2024-09-01", prescriber:"p3", nextControl:"2024-10-15", followup:"Revisar necesidad continua" },
];

const RAW_PATIENTS = [
  {
    id:"PAC-001", initials:"M.G.C.", age:34, gender:"F",
    dx_main:"Trastorno Bipolar Tipo I (F31.1)", dx_secondary:["Abuso de alcohol (F10.1)","Ansiedad generalizada (F41.1)"],
    risk:"critico", status:"activo",
    suicide_risk:"alto", hetero_risk:"bajo", social_risk:"alto",
    substances:"Alcohol (activo)", adherence:"Baja", functional:"Moderado deterioro", support:"Red débil",
    doctor:"p1", psychologist:"p4", ot:"p6", nurse:"p7", social:"p8",
    admission:"2023-06-15", last_contact:"2024-09-28", next_control:"2024-10-05",
    meds:["m3","m6"], alerts:3, tasks:4,
    notes:"Paciente con episodio maníaco activo. Hospitalización reciente (30 días). Alta hace 2 semanas. Seguimiento intensivo.",
  },
  {
    id:"PAC-002", initials:"J.A.M.", age:52, gender:"M",
    dx_main:"Esquizofrenia paranoide (F20.0)", dx_secondary:["HTA (I10)","DM2 (E11)"],
    risk:"alto", status:"activo",
    suicide_risk:"medio", hetero_risk:"medio", social_risk:"medio",
    substances:"Tabaco (activo)", adherence:"Moderada", functional:"Moderado deterioro", support:"Familiar limitada",
    doctor:"p1", psychologist:"p4", ot:"p6", nurse:"p7", social:"p8",
    admission:"2022-01-10", last_contact:"2024-09-20", next_control:"2024-10-29",
    meds:["m4","m5"], alerts:2, tasks:3,
    notes:"En programa de clozapina. Hemograma mensual. Risperidona LAI suspendida por paciente, retomada con LAI alternativa.",
  },
  {
    id:"PAC-003", initials:"C.P.V.", age:27, gender:"F",
    dx_main:"TDM episodio severo con síntomas psicóticos (F32.3)", dx_secondary:["TEPT (F43.1)"],
    risk:"alto", status:"activo",
    suicide_risk:"alto", hetero_risk:"no_evaluado", social_risk:"medio",
    substances:"Ninguno referido", adherence:"Alta", functional:"Leve-moderado deterioro", support:"Pareja estable",
    doctor:"p2", psychologist:"p5", ot:null, nurse:"p7", social:null,
    admission:"2024-04-22", last_contact:"2024-09-25", next_control:"2024-10-08",
    meds:["m2","m9"], alerts:1, tasks:2,
    notes:"Respuesta positiva a tratamiento. Psicosis resuelta. Mantener seguimiento semanal por antecedente suicida.",
  },
  {
    id:"PAC-004", initials:"R.T.L.", age:45, gender:"M",
    dx_main:"Trastorno de la personalidad límite (F60.3)", dx_secondary:["TDM recurrente (F33)","Abuso de cannabis (F12.1)"],
    risk:"alto", status:"inasistente",
    suicide_risk:"alto", hetero_risk:"bajo", social_risk:"alto",
    substances:"Cannabis (activo), Alcohol esporádico", adherence:"Muy baja", functional:"Severo deterioro", support:"Sin red",
    doctor:"p2", psychologist:"p4", ot:"p6", nurse:"p7", social:"p8",
    admission:"2023-09-03", last_contact:"2024-08-30", next_control:"2024-09-10",
    meds:["m7","m2"], alerts:4, tasks:5,
    notes:"INASISTENTE desde hace 31 días. Intentó contacto fallido x2. Riesgo suicida alto conocido. REQUIERE ACCIÓN.",
  },
  {
    id:"PAC-005", initials:"L.M.S.", age:19, gender:"F",
    dx_main:"Primer episodio psicótico (F23.1)", dx_secondary:["Ansiedad social (F40.1)"],
    risk:"medio", status:"activo",
    suicide_risk:"bajo", hetero_risk:"no_evaluado", social_risk:"medio",
    substances:"Cannabis occasional (pasado)", adherence:"Alta", functional:"Leve deterioro", support:"Familia presente",
    doctor:"p1", psychologist:"p5", ot:"p6", nurse:"p7", social:"p8",
    admission:"2024-07-15", last_contact:"2024-09-26", next_control:"2024-10-10",
    meds:["m1","m2"], alerts:1, tasks:2,
    notes:"Buena respuesta inicial. Primer episodio. Educación familiar en curso. Evaluar reducción antipsicótico en 6 meses.",
  },
  {
    id:"PAC-006", initials:"H.B.R.", age:61, gender:"M",
    dx_main:"Trastorno depresivo mayor recurrente (F33.2)", dx_secondary:["EPOC (J44)","Hipotiroidismo (E03)"],
    risk:"medio", status:"activo",
    suicide_risk:"medio", hetero_risk:"bajo", social_risk:"bajo",
    substances:"Alcohol moderado (pasado)", adherence:"Alta", functional:"Leve deterioro", support:"Red familiar estable",
    doctor:"p3", psychologist:"p4", ot:null, nurse:"p7", social:null,
    admission:"2022-11-08", last_contact:"2024-09-18", next_control:"2024-10-18",
    meds:["m8"], alerts:0, tasks:1,
    notes:"Estable. Tercer episodio depresivo en tratamiento. TSH y función tiroidea en control con médico tratante.",
  },
  {
    id:"PAC-007", initials:"A.F.N.", age:38, gender:"F",
    dx_main:"TOC (F42)", dx_secondary:["Ansiedad generalizada (F41.1)"],
    risk:"bajo", status:"activo",
    suicide_risk:"bajo", hetero_risk:"bajo", social_risk:"bajo",
    substances:"Ninguno", adherence:"Alta", functional:"Sin deterioro significativo", support:"Red sólida",
    doctor:"p2", psychologist:"p5", ot:null, nurse:null, social:null,
    admission:"2024-01-20", last_contact:"2024-09-22", next_control:"2024-10-22",
    meds:["m2"], alerts:0, tasks:1,
    notes:"Respondedora a sertralina + TCC. Estable. Control mensual.",
  },
  {
    id:"PAC-008", initials:"D.Q.M.", age:55, gender:"M",
    dx_main:"Trastorno esquizoafectivo tipo bipolar (F25.0)", dx_secondary:["DM2 (E11)","Obesidad (E66)"],
    risk:"alto", status:"hospitalizado",
    suicide_risk:"alto", hetero_risk:"bajo", social_risk:"alto",
    substances:"Tabaco activo", adherence:"Variable", functional:"Severo deterioro", support:"Red familiar agotada",
    doctor:"p1", psychologist:"p4", ot:"p6", nurse:"p7", social:"p8",
    admission:"2021-05-20", last_contact:"2024-09-30", next_control:"2024-10-15",
    meds:["m1","m6","m4"], alerts:3, tasks:3,
    notes:"Hospitalizado desde el 28 sep. Descompensación afectiva con sintomatología psicótica. Coordinar alta planificada.",
  },
  {
    id:"PAC-009", initials:"N.E.C.", age:23, gender:"F",
    dx_main:"Anorexia nerviosa tipo restrictivo (F50.0)", dx_secondary:["TDM moderado (F32.1)","Ansiedad (F41.9)"],
    risk:"alto", status:"activo",
    suicide_risk:"medio", hetero_risk:"bajo", social_risk:"medio",
    substances:"Ninguno", adherence:"Parcial", functional:"Moderado deterioro", support:"Padres en conflicto",
    doctor:"p3", psychologist:"p5", ot:"p6", nurse:"p7", social:"p8",
    admission:"2024-06-01", last_contact:"2024-09-24", next_control:"2024-10-07",
    meds:["m2","m10"], alerts:2, tasks:3,
    notes:"IMC 16.5 en último control. Psicoeducación nutricional iniciada. Intervención familiar en curso.",
  },
  {
    id:"PAC-010", initials:"P.O.S.", age:72, gender:"M",
    dx_main:"Demencia leve de tipo Alzheimer (F00.1)", dx_secondary:["HTA (I10)","FA (I48)"],
    risk:"medio", status:"activo",
    suicide_risk:"no_evaluado", hetero_risk:"no_evaluado", social_risk:"alto",
    substances:"Ninguno", adherence:"Supervisada", functional:"Leve-moderado deterioro", support:"Cuidador principal",
    doctor:"p3", psychologist:"p4", ot:"p6", nurse:"p7", social:"p8",
    admission:"2024-02-10", last_contact:"2024-09-20", next_control:"2024-10-20",
    meds:["m10"], alerts:1, tasks:2,
    notes:"Seguimiento neurocognitivo. Cuidador con síntomas de burnout. Intervención de trabajo social activa.",
  },
  {
    id:"PAC-011", initials:"S.V.A.", age:31, gender:"M",
    dx_main:"TDAH adulto (F90.0)", dx_secondary:["TDM leve (F32.0)"],
    risk:"bajo", status:"alta",
    suicide_risk:"bajo", hetero_risk:"bajo", social_risk:"bajo",
    substances:"Alcohol social", adherence:"Alta", functional:"Sin deterioro", support:"Adecuada",
    doctor:"p2", psychologist:"p5", ot:null, nurse:null, social:null,
    admission:"2023-08-01", last_contact:"2024-09-01", next_control:null,
    meds:["m8"], alerts:0, tasks:0,
    notes:"Alta clínica. Se mantiene en control con psiquiatra cada 3 meses por medicación. Buena evolución.",
  },
  {
    id:"PAC-012", initials:"K.I.P.", age:44, gender:"F",
    dx_main:"TEPT complejo (F43.1)", dx_secondary:["Disociación (F44.9)","TDM recurrente (F33.1)"],
    risk:"medio", status:"activo",
    suicide_risk:"medio", hetero_risk:"bajo", social_risk:"medio",
    substances:"Tabaco activo", adherence:"Moderada", functional:"Moderado deterioro", support:"Pareja, sin familia",
    doctor:"p2", psychologist:"p5", ot:"p6", nurse:null, social:"p8",
    admission:"2023-12-05", last_contact:"2024-09-16", next_control:"2024-10-16",
    meds:["m2","m9"], alerts:1, tasks:2,
    notes:"En terapia EMDR. Progreso lento pero sostenido. Coordinar con TO para reinserción laboral.",
  },
];

const RAW_ALERTS = [
  { id:"a1",  title:"Litemia vencida",                     patient:"PAC-001", responsible:"p1", due:"2024-10-01", status:"pendiente",   priority:"critico", type:"farmaco",   comment:"Sin litemia desde ago. Riesgo toxicidad." },
  { id:"a2",  title:"Paciente inasistente - riesgo alto",  patient:"PAC-004", responsible:"p2", due:"2024-09-12", status:"pendiente",   priority:"critico", type:"riesgo",    comment:"No responde llamadas. Contactar red de apoyo." },
  { id:"a3",  title:"Hemograma clozapina vencido",         patient:"PAC-002", responsible:"p7", due:"2024-10-01", status:"pendiente",   priority:"alto",    type:"farmaco",   comment:"Último hemograma: 01-sep. Reprogramar urgente." },
  { id:"a4",  title:"Control metabólico pendiente",        patient:"PAC-001", responsible:"p1", due:"2024-10-10", status:"pendiente",   priority:"alto",    type:"farmaco",   comment:"Perfil lipídico + glicemia desde oct 2023." },
  { id:"a5",  title:"Inyección LAI atrasada",              patient:"PAC-002", responsible:"p7", due:"2024-09-30", status:"en_curso",    priority:"alto",    type:"farmaco",   comment:"Reprogramar para 29 oct con EU Pinto." },
  { id:"a6",  title:"Sin próximo control agendado",        patient:"PAC-004", responsible:"p2", due:"2024-09-10", status:"pendiente",   priority:"critico", type:"control",   comment:"Última cita no se presentó. Riesgo suicida alto." },
  { id:"a7",  title:"Benzodiacepina uso prolongado",       patient:"PAC-004", responsible:"p2", due:"2024-10-10", status:"pendiente",   priority:"medio",   type:"farmaco",   comment:"Lorazepam >90 días. Evaluar plan de reducción." },
  { id:"a8",  title:"Control psiquiátrico mensual",        patient:"PAC-005", responsible:"p1", due:"2024-10-10", status:"pendiente",   priority:"medio",   type:"control",   comment:"Primer episodio psicótico. Seguimiento estricto." },
  { id:"a9",  title:"Riesgo suicida reevaluar",            patient:"PAC-003", responsible:"p2", due:"2024-10-08", status:"pendiente",   priority:"alto",    type:"riesgo",    comment:"Escala C-SSRS pendiente en próxima consulta." },
  { id:"a10", title:"Clonazepam: revisar continuidad",     patient:"PAC-009", responsible:"p3", due:"2024-10-15", status:"pendiente",   priority:"medio",   type:"farmaco",   comment:">60 días. Evaluar descontinuación gradual." },
  { id:"a11", title:"Coordinación alta hospitalaria",      patient:"PAC-008", responsible:"p1", due:"2024-10-15", status:"en_curso",    priority:"alto",    type:"control",   comment:"Alta planificada. Definir responsables post-alta." },
  { id:"a12", title:"Psicoeducación familiar pendiente",   patient:"PAC-009", responsible:"p8", due:"2024-10-07", status:"pendiente",   priority:"medio",   type:"tarea",     comment:"Sesión con padres postergada x2." },
  { id:"a13", title:"Reunión clínica de caso",             patient:"PAC-001", responsible:"p1", due:"2024-10-03", status:"resuelto",    priority:"alto",    type:"reunion",   comment:"Realizada el 03-oct. Acuerdos documentados." },
  { id:"a14", title:"Valproemia pendiente",                patient:"PAC-001", responsible:"p1", due:"2024-10-28", status:"pendiente",   priority:"medio",   type:"farmaco",   comment:"Control programado 28 oct." },
  { id:"a15", title:"Evaluación deterioro cognitivo",      patient:"PAC-010", responsible:"p4", due:"2024-10-20", status:"pendiente",   priority:"medio",   type:"control",   comment:"MMSE + MoCA a reaplicar." },
  { id:"a16", title:"Burnout cuidador detectado",          patient:"PAC-010", responsible:"p8", due:"2024-10-10", status:"en_curso",    priority:"medio",   type:"tarea",     comment:"Intervención T. Social iniciada. Visita domiciliaria programada." },
  { id:"a17", title:"TSH control pendiente",               patient:"PAC-006", responsible:"p3", due:"2024-10-18", status:"pendiente",   priority:"bajo",    type:"farmaco",   comment:"Hipotiroidismo en control médico. Cruce de fármacos evaluar." },
  { id:"a18", title:"Reinserción laboral plan TO",         patient:"PAC-012", responsible:"p6", due:"2024-10-16", status:"en_curso",    priority:"bajo",    type:"tarea",     comment:"Coordinación con TO para evaluación funcional laboral." },
  { id:"a19", title:"Receta próxima a vencer - Sertralina",patient:"PAC-007", responsible:"p2", due:"2024-10-22", status:"pendiente",   priority:"bajo",    type:"farmaco",   comment:"Receta válida hasta el 25 oct." },
  { id:"a20", title:"IMC crítico - evaluar hospitalización",patient:"PAC-009", responsible:"p1", due:"2024-10-07", status:"pendiente",   priority:"critico", type:"riesgo",    comment:"IMC 16.5. Protocolo de bajo peso crítico." },
];

const RAW_TRACE_EVENTS = [
  { id:"t1",  ts:"2024-09-30 09:14", user:"p1", action:"Edición",          patient:"PAC-001", field:"Riesgo suicida",  prev:"medio",      next:"alto",        type:"edicion"  },
  { id:"t2",  ts:"2024-09-30 09:17", user:"p1", action:"Alerta creada",    patient:"PAC-001", field:"-",               prev:"-",          next:"Litemia vencida", type:"alerta" },
  { id:"t3",  ts:"2024-09-28 11:32", user:"p7", action:"Edición",          patient:"PAC-002", field:"Estado",          prev:"activo",     next:"hospitalizado",type:"edicion"},
  { id:"t4",  ts:"2024-09-27 14:05", user:"p8", action:"Archivo adjunto",  patient:"PAC-009", field:"-",               prev:"-",          next:"Informe_social_09.pdf", type:"archivo"},
  { id:"t5",  ts:"2024-09-26 16:20", user:"p2", action:"Edición",          patient:"PAC-003", field:"Próximo control", prev:"2024-10-15", next:"2024-10-08",  type:"edicion"  },
  { id:"t6",  ts:"2024-09-25 10:00", user:"p4", action:"Tarea resuelta",   patient:"PAC-005", field:"Psicoeducación familiar sesión 2", prev:"pendiente", next:"resuelto", type:"tarea"},
  { id:"t7",  ts:"2024-09-24 09:45", user:"p6", action:"Edición",          patient:"PAC-012", field:"Adherencia estimada", prev:"baja",   next:"moderada",    type:"edicion"  },
  { id:"t8",  ts:"2024-09-23 12:10", user:"p1", action:"Creación paciente",patient:"PAC-005", field:"-",               prev:"-",          next:"Nuevo registro", type:"creacion"},
  { id:"t9",  ts:"2024-09-22 15:30", user:"p3", action:"Edición",          patient:"PAC-006", field:"Fármaco",         prev:"Bupropión 100mg", next:"Bupropión 150mg", type:"edicion"},
  { id:"t10", ts:"2024-09-21 08:55", user:"p5", action:"Mensaje enviado",  patient:"PAC-003", field:"-",               prev:"-",          next:"Derivación psicoeducativa", type:"mensaje"},
  { id:"t11", ts:"2024-09-20 17:40", user:"p7", action:"Alerta resuelta",  patient:"PAC-002", field:"Hemograma LAI",   prev:"pendiente",  next:"resuelto",    type:"alerta"   },
  { id:"t12", ts:"2024-09-19 11:15", user:"p8", action:"Cambio responsable",patient:"PAC-010",field:"Trabajo Social",  prev:"Sin asignar",next:"p8",          type:"edicion"  },
  { id:"t13", ts:"2024-09-18 10:00", user:"p2", action:"Edición",          patient:"PAC-004", field:"Estado",          prev:"activo",     next:"inasistente", type:"edicion"  },
  { id:"t14", ts:"2024-09-17 14:20", user:"p1", action:"Edición",          patient:"PAC-008", field:"Riesgo social",   prev:"medio",      next:"alto",        type:"edicion"  },
  { id:"t15", ts:"2024-09-16 09:30", user:"p4", action:"Archivo adjunto",  patient:"PAC-001", field:"-",               prev:"-",          next:"Evaluacion_funcional_001.pdf", type:"archivo"},
];

const RAW_MESSAGES = [
  { id:"msg1",  from:"p1", to:"p4",   patient:"PAC-001", ts:"2024-09-30 09:20", text:"Roberto, revisaste el último informe funcional de M.G.C.? Hay que actualizar plan antes del control del jueves.", important:true,  read:false },
  { id:"msg2",  from:"p4", to:"p1",   patient:"PAC-001", ts:"2024-09-30 09:45", text:"Sí, lo revisé. Sugiero agregar sesión de psicoeducación en el plan. Te mando resumen hoy.", important:false, read:true  },
  { id:"msg3",  from:"p2", to:"p7",   patient:"PAC-002", ts:"2024-09-29 11:00", text:"Jorge, el hemograma de J.A.M. está atrasado. Por favor coordinar con el paciente esta semana.", important:true,  read:false },
  { id:"msg4",  from:"p7", to:"p2",   patient:"PAC-002", ts:"2024-09-29 11:30", text:"Entendido Dr. Méndez. Contactaré hoy al familiar de turno. Confirmo antes del viernes.", important:false, read:true  },
  { id:"msg5",  from:"p8", to:"p1",   patient:"PAC-004", ts:"2024-09-28 14:00", text:"Dra. Rojas, llevamos 31 días sin contacto con R.T.L. Intentamos domicilio mañana. ¿Acuerda?", important:true,  read:false },
  { id:"msg6",  from:"p1", to:"p8",   patient:"PAC-004", ts:"2024-09-28 14:45", text:"Sí Patricia, coordina con Jorge para ir juntos. Si no hay respuesta, escalar a protocolo de riesgo.", important:true,  read:true  },
  { id:"msg7",  from:"p5", to:"p3",   patient:"PAC-009", ts:"2024-09-27 16:20", text:"Camila, cómo sigue el peso de N.E.C.? Mi impresión en sesión es que está peor. ¿Qué marca la última consulta?", important:false, read:true  },
  { id:"msg8",  from:"p3", to:"p5",   patient:"PAC-009", ts:"2024-09-27 17:00", text:"IMC 16.5 el lunes. Estamos en límite. Voy a convocar reunión clínica para esta semana.", important:true,  read:true  },
  { id:"msg9",  from:"p6", to:"p4",   patient:"PAC-012", ts:"2024-09-26 10:10", text:"Roberto, hablé con K.I.P. sobre el tema laboral. Está más receptiva. ¿Coordinamos sesión conjunta?", important:false, read:false },
  { id:"msg10", from:"p4", to:"p6",   patient:"PAC-012", ts:"2024-09-26 10:45", text:"Perfecto Marcela, la semana del 7 de octubre me vendría bien. Confirma disponibilidad.", important:false, read:true  },
];

const RAW_FILES = [
  { id:"f1", name:"Evaluacion_funcional_001.pdf", size:"1.2 MB", date:"2024-09-16", author:"p4", patient:"PAC-001", type:"pdf" },
  { id:"f2", name:"Informe_social_09.pdf",        size:"0.8 MB", date:"2024-09-27", author:"p8", patient:"PAC-009", type:"pdf" },
  { id:"f3", name:"Hemograma_PAC002_sep.pdf",     size:"0.5 MB", date:"2024-09-05", author:"p7", patient:"PAC-002", type:"pdf" },
  { id:"f4", name:"Plan_TO_rehabilitacion.pdf",   size:"1.1 MB", date:"2024-09-20", author:"p6", patient:"PAC-012", type:"pdf" },
  { id:"f5", name:"Registro_contacto_004.pdf",    size:"0.3 MB", date:"2024-09-28", author:"p8", patient:"PAC-004", type:"pdf" },
];


// ─── ASIGNACIÓN MOCK POR INSTITUCIÓN ──────────────────────────────────────
// En una versión con backend, este campo debería venir de la tabla institution_id
// de cada paciente, profesional, alerta, archivo y evento de auditoría.
const CENTER_PATIENT_IDS = new Set(["PAC-001", "PAC-002", "PAC-003", "PAC-004", "PAC-005", "PAC-006"]);
const PROF_TO_HOSPITAL_PROF = {
  p1: "h1", p2: "h2", p3: "h3", p4: "h4", p5: "h5", p6: "h6", p7: "h7", p8: "h8",
};
const HOSPITAL_PROFESSIONALS = [
  { id:"h1", name:"Dra. Elisa Morales",       role:"psiquiatra_jefe",  specialty:"Psiquiatría Enlace / Hospital", patients:3, initials:"EM", color:"bg-violet-600", institution:"hospital" },
  { id:"h2", name:"Dr. Ignacio Torres",      role:"psiquiatra",       specialty:"Psiquiatría Adultos Hospital", patients:3, initials:"IT", color:"bg-sky-600",    institution:"hospital" },
  { id:"h3", name:"Dra. Paulina Vega",       role:"medico_general",   specialty:"Medicina Interna / SM",        patients:2, initials:"PV", color:"bg-teal-600",   institution:"hospital" },
  { id:"h4", name:"Ps. Natalia Peña",        role:"psicologo",        specialty:"Psicología Hospitalaria",       patients:3, initials:"NP", color:"bg-indigo-600", institution:"hospital" },
  { id:"h5", name:"Ps. Diego Carrasco",      role:"psicologo",        specialty:"Neuropsicología Hospitalaria",  patients:2, initials:"DC", color:"bg-pink-600",   institution:"hospital" },
  { id:"h6", name:"T.O. Tomás Salazar",      role:"terapeuta",        specialty:"Rehabilitación Hospitalaria",   patients:4, initials:"TS", color:"bg-amber-600",  institution:"hospital" },
  { id:"h7", name:"EU. Claudia Silva",       role:"enfermero",        specialty:"Enfermería Hospital Día",       patients:5, initials:"CS", color:"bg-cyan-600",   institution:"hospital" },
  { id:"h8", name:"T.S. Mario Araya",        role:"trabajador_social",specialty:"Trabajo Social Hospitalario",    patients:4, initials:"MA", color:"bg-rose-600",   institution:"hospital" },
];

RAW_PROFESSIONALS.forEach(p => { p.institution = "centro_medico"; });
RAW_PROFESSIONALS.push(...HOSPITAL_PROFESSIONALS);

RAW_PATIENTS.forEach(patient => {
  patient.institution = CENTER_PATIENT_IDS.has(patient.id) ? "centro_medico" : "hospital";
  if (patient.institution === "hospital") {
    ["doctor", "psychologist", "ot", "nurse", "social"].forEach(field => {
      if (patient[field] && PROF_TO_HOSPITAL_PROF[patient[field]]) patient[field] = PROF_TO_HOSPITAL_PROF[patient[field]];
    });
  }
});

const getRawPatient = (id) => RAW_PATIENTS.find(p => p.id === id);
const getRawPatientInstitution = (id) => getRawPatient(id)?.institution || "centro_medico";
const mapHospitalProf = (id, institution) => institution === "hospital" && PROF_TO_HOSPITAL_PROF[id] ? PROF_TO_HOSPITAL_PROF[id] : id;


// Programas específicos añadidos para demostrar seguimiento de depósito en ambos espacios.
RAW_MEDICATIONS.push(
  { id:"m11", drug:"Paliperidona Palmitato LAI", dose:"100 mg", scheme:"IM/28d", freq:"Cada 28 días", startDate:"2024-07-12", lastAdj:"2024-09-06", prescriber:"p2", nextControl:"2024-10-04", followup:"Seguimiento inyectable de depósito" },
  { id:"m12", drug:"Aripiprazol LAI", dose:"400 mg", scheme:"IM/28d", freq:"Cada 28 días", startDate:"2024-08-02", lastAdj:"2024-09-02", prescriber:"p2", nextControl:"2024-09-30", followup:"Próxima administración programada" }
);
const pac011ForDepot = RAW_PATIENTS.find(p => p.id === "PAC-011");
if (pac011ForDepot && !pac011ForDepot.meds.includes("m11")) pac011ForDepot.meds.push("m11");
const pac003ForDepot = RAW_PATIENTS.find(p => p.id === "PAC-003");
if (pac003ForDepot && !pac003ForDepot.meds.includes("m12")) pac003ForDepot.meds.push("m12");

RAW_MEDICATIONS.forEach(med => { med.institution = "centro_medico"; });
const duplicatedHospitalMeds = new Map();
RAW_PATIENTS.filter(p => p.institution === "hospital").forEach(patient => {
  patient.meds = patient.meds.map(medId => {
    const original = RAW_MEDICATIONS.find(m => m.id === medId);
    if (!original) return medId;
    const hospitalMedId = `h_${medId}`;
    if (!duplicatedHospitalMeds.has(hospitalMedId)) {
      const copy = {
        ...original,
        id: hospitalMedId,
        prescriber: mapHospitalProf(original.prescriber, "hospital"),
        institution: "hospital",
      };
      duplicatedHospitalMeds.set(hospitalMedId, copy);
    }
    return hospitalMedId;
  });
});
RAW_MEDICATIONS.push(...duplicatedHospitalMeds.values());

RAW_ALERTS.forEach(alert => {
  alert.institution = getRawPatientInstitution(alert.patient);
  alert.responsible = mapHospitalProf(alert.responsible, alert.institution);
});

RAW_TRACE_EVENTS.forEach(event => {
  event.institution = getRawPatientInstitution(event.patient);
  event.user = mapHospitalProf(event.user, event.institution);
});

RAW_MESSAGES.forEach(message => {
  message.institution = getRawPatientInstitution(message.patient);
  message.from = mapHospitalProf(message.from, message.institution);
  message.to = mapHospitalProf(message.to, message.institution);
});

RAW_FILES.forEach(file => {
  file.institution = getRawPatientInstitution(file.patient);
  file.author = mapHospitalProf(file.author, file.institution);
});

const createScopedCollection = (source, filterFn) => new Proxy(source, {
  get(target, prop) {
    const scoped = target.filter(filterFn);
    if (prop === Symbol.iterator) return scoped[Symbol.iterator].bind(scoped);
    if (prop === "raw") return target;
    if (prop === "scoped") return scoped;
    const value = scoped[prop];
    return typeof value === "function" ? value.bind(scoped) : value;
  },
  has(target, prop) {
    const scoped = target.filter(filterFn);
    return prop in scoped;
  },
});

const isActiveInstitution = item => item?.institution === ACTIVE_INSTITUTION_ID;
const ADMIN_USER = {
  id: "admin",
  name: "Administrador/a general",
  role: "admin",
  specialty: "Acceso completo institucional",
  initials: "AD",
  color: "bg-slate-600",
};
const CARE_TEAM_FIELDS = ["doctor", "psychologist", "ot", "nurse", "social"];
const getPatientTeamIds = (patient) => CARE_TEAM_FIELDS.map(field => patient?.[field]).filter(Boolean);
const getCurrentUser = () => ACTIVE_USER_ID === "admin" ? ADMIN_USER : RAW_PROFESSIONALS.find(p => p.id === ACTIVE_USER_ID) || ADMIN_USER;
const getUserOptions = () => [ADMIN_USER, ...RAW_PROFESSIONALS.filter(p => p.institution === ACTIVE_INSTITUTION_ID)];
const canAccessPatient = (patient) => Boolean(patient) && patient.institution === ACTIVE_INSTITUTION_ID && (
  ACTIVE_USER_ID === "admin" || getPatientTeamIds(patient).includes(ACTIVE_USER_ID)
);
const getVisiblePatientIds = () => new Set(RAW_PATIENTS.filter(canAccessPatient).map(p => p.id));
const canAccessProfessional = (prof) => {
  if (!prof || prof.institution !== ACTIVE_INSTITUTION_ID) return false;
  if (ACTIVE_USER_ID === "admin" || prof.id === ACTIVE_USER_ID) return true;
  return RAW_PATIENTS.some(patient => canAccessPatient(patient) && getPatientTeamIds(patient).includes(prof.id));
};
const canAccessPatientLinkedItem = (item) => item?.institution === ACTIVE_INSTITUTION_ID && getVisiblePatientIds().has(item.patient);

const PROFESSIONALS = createScopedCollection(RAW_PROFESSIONALS, canAccessProfessional);
const PATIENTS = createScopedCollection(RAW_PATIENTS, canAccessPatient);
const isActiveMedication = item => item?.institution === ACTIVE_INSTITUTION_ID && RAW_PATIENTS.some(patient => canAccessPatient(patient) && patient.meds.includes(item.id));
const MEDICATIONS = createScopedCollection(RAW_MEDICATIONS, isActiveMedication);
const ALERTS = createScopedCollection(RAW_ALERTS, canAccessPatientLinkedItem);
const TRACE_EVENTS = createScopedCollection(RAW_TRACE_EVENTS, canAccessPatientLinkedItem);
const MESSAGES = createScopedCollection(RAW_MESSAGES, canAccessPatientLinkedItem);
const FILES = createScopedCollection(RAW_FILES, canAccessPatientLinkedItem);

const DEMO_TODAY = new Date().toISOString().slice(0, 10);
const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysUntil = (dateStr) => Math.ceil((new Date(`${dateStr}T00:00:00`) - new Date(`${DEMO_TODAY}T00:00:00`)) / 86400000);
const dueStatus = (dateStr) => {
  const d = daysUntil(dateStr);
  if (d < 0) return { label: `Atrasado ${Math.abs(d)} días`, tone: "text-red-400 border-red-700 bg-red-900/20" };
  if (d <= 3) return { label: `Vence en ${d} días`, tone: "text-orange-400 border-orange-700 bg-orange-900/20" };
  if (d <= 7) return { label: `Próximo en ${d} días`, tone: "text-yellow-400 border-yellow-700 bg-yellow-900/20" };
  return { label: `Vigente (${d} días)`, tone: "text-emerald-400 border-emerald-700 bg-emerald-900/20" };
};

const CLOZAPINE_TRACKING = {
  "PAC-002": { lastHemogram:"2024-09-05", periodicity:"Mensual", periodDays:30, anc:"4.100", wbc:"7.800", note:"Programa clozapina activo; hemograma mensual obligatorio." },
  "PAC-008": { lastHemogram:"2024-09-20", periodicity:"Mensual", periodDays:30, anc:"3.600", wbc:"6.900", note:"Hospitalizado; coordinar hemograma previo a alta." },
};
const DEPOT_TRACKING = {
  "PAC-002": { lastAdministration:"2024-09-15", nextAdministration:"2024-09-29", periodicity:"Cada 14 días", site:"Deltoides", responsible:"p7", note:"Risperidona LAI; administración atrasada según registro demo." },
  "PAC-003": { lastAdministration:"2024-09-02", nextAdministration:"2024-09-30", periodicity:"Cada 28 días", site:"Glúteo", responsible:"p7", note:"Aripiprazol LAI; control de tolerancia y adherencia." },
  "PAC-011": { lastAdministration:"2024-09-06", nextAdministration:"2024-10-04", periodicity:"Cada 28 días", site:"Deltoides", responsible:"h7", note:"Paliperidona LAI; seguimiento hospitalario." },
};


const replaceCollection = (target, rows) => {
  target.splice(0, target.length, ...(rows || []));
};

const resetTrackingObject = (obj) => {
  Object.keys(obj).forEach(key => delete obj[key]);
};

const mapInstitutionFromDb = (institutionId, institutionById) => {
  const inst = institutionById.get(institutionId);
  return normalizeWorkspaceId(inst);
};

const loadWorkspaceDataFromSupabase = async (session) => {
  if (!isSupabaseConfigured || !session?.user?.id) {
    return { authProfile: getAuthProfileFromEmail(session?.user?.email) };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,is_active")
    .eq("id", session.user.id)
    .single();

  if (profileError) throw profileError;
  if (!profile) throw new Error("No existe perfil en public.profiles para este usuario. Crea el perfil y sus memberships en Supabase.");
  if (profile.is_active === false) throw new Error("Tu perfil está desactivado.");

  const { data: membershipsDb, error: membershipsError } = await supabase
    .from("memberships")
    .select("id,user_id,institution_id,professional_id,role,status,is_default,is_active,created_at,institutions(id,slug,name,kind,description),professionals(id,full_name,role,specialty,email,initials,avatar_color)")
    .eq("user_id", session.user.id)
    .eq("is_active", true)
    .eq("status", "approved")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (membershipsError) throw membershipsError;
  if (!membershipsDb?.length) throw new Error("Tu cuenta existe, pero aún no tiene acceso aprobado a ninguna institución. Pide a un superadmin o administrador institucional que te asigne permisos.");

  const [
    institutionsRes,
    professionalsRes,
    patientsRes,
    patientTeamRes,
    medicationsRes,
    clozapineRes,
    laiRes,
    alertsRes,
    traceRes,
    messagesRes,
    filesRes,
  ] = await Promise.all([
    supabase.from("institutions").select("*"),
    supabase.from("professionals").select("*").order("full_name"),
    supabase.from("patients").select("*").order("clinical_code"),
    supabase.from("patient_team").select("*"),
    supabase.from("medications").select("*").order("created_at", { ascending: true }),
    supabase.from("clozapine_programs").select("*"),
    supabase.from("lai_programs").select("*"),
    supabase.from("alerts").select("*").order("due_date", { ascending: true }),
    supabase.from("trace_events").select("*").order("created_at", { ascending: false }),
    supabase.from("messages").select("*").order("created_at", { ascending: false }),
    supabase.from("files").select("*").order("created_at", { ascending: false }),
  ]);

  const responses = [institutionsRes, professionalsRes, patientsRes, patientTeamRes, medicationsRes, clozapineRes, laiRes, alertsRes, traceRes, messagesRes, filesRes];
  const firstError = responses.find(r => r.error)?.error;
  if (firstError) throw firstError;

  const institutions = institutionsRes.data || [];
  const professionalsDb = professionalsRes.data || [];
  const patientsDb = patientsRes.data || [];
  const patientTeamDb = patientTeamRes.data || [];
  const medicationsDb = medicationsRes.data || [];
  const clozapineDb = clozapineRes.data || [];
  const laiDb = laiRes.data || [];
  const alertsDb = alertsRes.data || [];
  const traceDb = traceRes.data || [];
  const messagesDb = messagesRes.data || [];
  const filesDb = filesRes.data || [];

  const institutionById = new Map(institutions.map(i => [i.id, i]));
  membershipsDb.forEach(m => {
    if (m.institutions && !institutionById.has(m.institution_id)) {
      institutionById.set(m.institution_id, m.institutions);
    }
  });

  const membershipRows = membershipsDb.map(m => {
    const instRecord = m.institutions || institutionById.get(m.institution_id) || {};
    const workspaceId = normalizeWorkspaceId(instRecord);
    const fallbackInst = INSTITUTIONS.find(i => i.id === workspaceId) || INSTITUTIONS[0];
    return {
      id: m.id,
      institution: workspaceId,
      institutionDbId: m.institution_id,
      role: m.role,
      professionalId: m.professional_id,
      isDefault: Boolean(m.is_default),
      label: instRecord.name || fallbackInst.label,
      professionalName: m.professionals?.full_name || profile.full_name || profile.email,
      institutionUi: {
        ...fallbackInst,
        id: workspaceId,
        label: instRecord.name || fallbackInst.label,
        short: (instRecord.name || fallbackInst.short || fallbackInst.label).replace(/^Centro Médico$/i, "Centro"),
        description: instRecord.description || fallbackInst.description,
      },
    };
  });
  setAccessibleInstitutionsFromMemberships(membershipRows);

  const professionalRows = professionalsDb.map(pr => ({
    id: pr.id,
    name: pr.full_name,
    role: normalizeRoleForApp(pr.role),
    specialty: pr.specialty || "",
    patients: 0,
    initials: pr.initials || (pr.full_name || "?").split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase(),
    color: pr.avatar_color || "bg-slate-600",
    institution: mapInstitutionFromDb(pr.institution_id, institutionById),
    email: pr.email,
    _dbId: pr.id,
  }));

  const patientCodeByUuid = new Map();
  const patientByUuid = new Map();
  const patientRows = patientsDb.map(p => {
    const row = {
      id: p.clinical_code,
      _dbId: p.id,
      institution: mapInstitutionFromDb(p.institution_id, institutionById),
      initials: p.initials,
      age: p.age,
      gender: p.gender || "NR",
      dx_main: p.dx_main || "Sin diagnóstico principal registrado",
      dx_secondary: Array.isArray(p.dx_secondary) ? p.dx_secondary : [],
      risk: p.risk || "no_evaluado",
      status: p.status || "activo",
      suicide_risk: p.suicide_risk || "no_evaluado",
      hetero_risk: p.hetero_risk || "no_evaluado",
      social_risk: p.social_risk || "no_evaluado",
      substances: p.substances || "—",
      adherence: p.adherence || "—",
      functional: p.functional_status || "—",
      support: p.support_network || "—",
      doctor: null,
      psychologist: null,
      ot: null,
      nurse: null,
      social: null,
      admission: p.admission_date,
      last_contact: p.last_contact_date,
      next_control: p.next_control_date,
      meds: [],
      alerts: 0,
      tasks: 0,
      notes: p.notes || "",
    };
    patientCodeByUuid.set(p.id, p.clinical_code);
    patientByUuid.set(p.id, row);
    return row;
  });

  const roleToPatientField = (teamRole) => {
    if (["medico", "psiquiatra"].includes(teamRole)) return "doctor";
    if (teamRole === "psicologo") return "psychologist";
    if (teamRole === "terapeuta_ocupacional") return "ot";
    if (teamRole === "enfermero") return "nurse";
    if (teamRole === "trabajador_social") return "social";
    return null;
  };

  patientTeamDb.forEach(team => {
    const patient = patientByUuid.get(team.patient_id);
    const field = roleToPatientField(team.team_role);
    if (patient && field && (!patient[field] || team.is_primary)) patient[field] = team.professional_id;
  });

  const medicationRows = [];
  medicationsDb.forEach(m => {
    const code = patientCodeByUuid.get(m.patient_id);
    const patient = patientByUuid.get(m.patient_id);
    if (!code || !patient) return;
    medicationRows.push({
      id: m.id,
      _dbId: m.id,
      institution: mapInstitutionFromDb(m.institution_id, institutionById),
      drug: m.drug,
      dose: m.dose || "",
      scheme: m.scheme || "",
      freq: m.frequency || "",
      startDate: m.start_date,
      lastAdj: m.last_adjustment_date,
      prescriber: m.prescriber_professional_id,
      nextControl: m.next_control_date,
      followup: m.followup || "",
      program: m.program || "general",
    });
    if (!patient.meds.includes(m.id)) patient.meds.push(m.id);
  });

  resetTrackingObject(CLOZAPINE_TRACKING);
  clozapineDb.forEach(c => {
    const code = patientCodeByUuid.get(c.patient_id);
    if (!code) return;
    CLOZAPINE_TRACKING[code] = {
      _dbId: c.id,
      medicationDbId: c.medication_id || null,
      lastHemogram: c.last_cbc_date,
      nextHemogram: c.next_cbc_date,
      periodicity: `Cada ${c.cbc_frequency_days || 30} días`,
      periodDays: c.cbc_frequency_days || 30,
      anc: c.neutrophils ?? "—",
      wbc: c.leukocytes ?? "—",
      statusValue: c.status || "vigente",
      responsible: c.responsible_professional_id || null,
      startDate: c.start_date || null,
      note: c.notes || "",
    };
  });

  resetTrackingObject(DEPOT_TRACKING);
  laiDb.forEach(lai => {
    const code = patientCodeByUuid.get(lai.patient_id);
    const patient = patientByUuid.get(lai.patient_id);
    if (!code || !patient) return;
    const fakeMedicationId = lai.medication_id || `lai_${lai.id}`;
    if (!medicationRows.some(m => m.id === fakeMedicationId)) {
      medicationRows.push({
        id: fakeMedicationId,
        _dbId: lai.medication_id || null,
        institution: mapInstitutionFromDb(lai.institution_id, institutionById),
        drug: lai.drug,
        dose: lai.dose || "",
        scheme: `${lai.route || "IM"}/${lai.interval_days || "?"}d`,
        freq: `Cada ${lai.interval_days || "?"} días`,
        startDate: null,
        lastAdj: lai.last_administration_date,
        prescriber: lai.responsible_professional_id,
        nextControl: lai.next_administration_date,
        followup: lai.notes || "Seguimiento inyectable de depósito",
        program: "lai",
      });
    }
    if (!patient.meds.includes(fakeMedicationId)) patient.meds.push(fakeMedicationId);
    DEPOT_TRACKING[code] = {
      _dbId: lai.id,
      medicationDbId: lai.medication_id || null,
      lastAdministration: lai.last_administration_date,
      nextAdministration: lai.next_administration_date,
      periodicity: `Cada ${lai.interval_days || "?"} días`,
      intervalDays: lai.interval_days || "",
      route: lai.route || "IM",
      site: lai.administration_site || "—",
      statusValue: lai.status || "vigente",
      responsible: lai.responsible_professional_id,
      note: lai.notes || "",
    };
  });

  const alertRows = alertsDb.map(a => ({
    id: a.id,
    institution: mapInstitutionFromDb(a.institution_id, institutionById),
    title: a.title,
    patient: patientCodeByUuid.get(a.patient_id) || null,
    responsible: a.responsible_professional_id,
    due: a.due_date,
    status: a.status,
    priority: a.priority,
    type: a.type,
    comment: a.comment || "",
  }));

  const alertsByPatient = alertRows.reduce((acc, a) => {
    if (!a.patient) return acc;
    if (!acc[a.patient]) acc[a.patient] = { alerts: 0, tasks: 0 };
    if (a.status !== "resuelto" && a.status !== "cancelado") acc[a.patient].alerts += 1;
    if (["tarea", "control", "reunion"].includes(a.type) && a.status !== "resuelto" && a.status !== "cancelado") acc[a.patient].tasks += 1;
    return acc;
  }, {});
  patientRows.forEach(p => {
    p.alerts = alertsByPatient[p.id]?.alerts || 0;
    p.tasks = alertsByPatient[p.id]?.tasks || 0;
  });

  const traceRows = traceDb.map(ev => ({
    id: ev.id,
    institution: mapInstitutionFromDb(ev.institution_id, institutionById),
    ts: (ev.created_at || "").replace("T", " ").slice(0, 16),
    user: ev.actor_professional_id,
    action: ev.action,
    patient: patientCodeByUuid.get(ev.patient_id) || null,
    field: ev.field || "-",
    prev: ev.previous_value || "-",
    next: ev.next_value || "-",
    type: ev.event_type || "edicion",
  }));

  const messageRows = messagesDb.map(msg => ({
    id: msg.id,
    institution: mapInstitutionFromDb(msg.institution_id, institutionById),
    from: msg.from_professional_id,
    to: msg.to_professional_id,
    patient: patientCodeByUuid.get(msg.patient_id) || null,
    ts: (msg.created_at || "").replace("T", " ").slice(0, 16),
    text: msg.body,
    important: Boolean(msg.important),
    read: Boolean(msg.read_at),
  }));

  const fileRows = filesDb.map(file => ({
    id: file.id,
    institution: mapInstitutionFromDb(file.institution_id, institutionById),
    name: file.file_name,
    size: file.file_size_bytes ? `${Math.round(file.file_size_bytes / 1024)} KB` : "—",
    date: (file.created_at || "").slice(0, 10),
    author: file.uploaded_by,
    patient: patientCodeByUuid.get(file.patient_id) || null,
    type: file.file_type || "archivo",
  }));

  replaceCollection(RAW_PROFESSIONALS, professionalRows);
  replaceCollection(RAW_PATIENTS, patientRows);
  replaceCollection(RAW_MEDICATIONS, medicationRows);
  replaceCollection(RAW_ALERTS, alertRows);
  replaceCollection(RAW_TRACE_EVENTS, traceRows);
  replaceCollection(RAW_MESSAGES, messageRows);
  replaceCollection(RAW_FILES, fileRows);
  USING_SUPABASE_DATA = true;

  const defaultMembership = membershipRows.find(m => m.isDefault) || membershipRows[0];
  const workspaceId = defaultMembership?.institution || "centro_medico";
  return {
    authProfile: {
      appUserId: getAppUserIdForWorkspace(workspaceId, "admin"),
      institution: workspaceId,
      label: profile.full_name || profile.email,
      role: defaultMembership?.role || "admin",
      email: profile.email,
      memberships: membershipRows,
      membershipByInstitution: membershipRows.reduce((acc, m) => {
        acc[m.institution] = m;
        return acc;
      }, {}),
    },
    counts: {
      patients: patientRows.length,
      professionals: professionalRows.length,
      alerts: alertRows.length,
    },
  };
};

const getClozapineRows = () => PATIENTS.flatMap(patient => {
  const meds = patient.meds.map(mid => MEDICATIONS.find(m => m.id === mid)).filter(Boolean);
  return meds.filter(med => med.drug.toLowerCase().includes("clozapina")).map(med => {
    const t = CLOZAPINE_TRACKING[patient.id] || {};
    const lastHemogram = t.lastHemogram || med.lastAdj || patient.last_contact;
    const periodDays = t.periodDays || 30;
    const nextHemogram = t.nextHemogram || addDays(lastHemogram, periodDays);
    return {
      paciente: patient.id,
      patientDbId: patient._dbId || null,
      programDbId: t._dbId || null,
      medicationDbId: t.medicationDbId || med._dbId || med.id || null,
      iniciales: patient.initials,
      riesgo: patient.risk,
      estado: patient.status,
      farmaco: med.drug,
      dosis: med.dose,
      esquema: med.scheme,
      startDate: t.startDate || med.startDate || "",
      periodicidadHemograma: t.periodicity || "Mensual",
      periodDays: t.periodDays || 30,
      ultimoHemograma: lastHemogram,
      proximoHemograma: nextHemogram,
      dias: daysUntil(nextHemogram),
      neutrofilos: t.anc || "—",
      leucocitos: t.wbc || "—",
      responsibleId: t.responsible || med.prescriber || "",
      responsable: getProf(t.responsible || med.prescriber)?.name || t.responsible || med.prescriber,
      statusValue: t.statusValue || "vigente",
      nota: t.note || med.followup,
      status: dueStatus(nextHemogram),
    };
  });
});

const getDepotRows = () => PATIENTS.flatMap(patient => {
  const meds = patient.meds.map(mid => MEDICATIONS.find(m => m.id === mid)).filter(Boolean);
  return meds.filter(med => /lai|inyectable|dep[oó]sito|im\//i.test(`${med.drug} ${med.scheme} ${med.freq} ${med.followup}`)).map(med => {
    const t = DEPOT_TRACKING[patient.id] || {};
    const lastAdministration = t.lastAdministration || med.lastAdj;
    const nextAdministration = t.nextAdministration || med.nextControl;
    return {
      paciente: patient.id,
      patientDbId: patient._dbId || null,
      programDbId: t._dbId || null,
      medicationDbId: t.medicationDbId || med._dbId || null,
      iniciales: patient.initials,
      riesgo: patient.risk,
      estado: patient.status,
      farmaco: med.drug,
      dosis: med.dose,
      esquema: med.scheme,
      intervalDays: t.intervalDays || String(med.freq || "").match(/(\d+)/)?.[1] || "28",
      route: t.route || "IM",
      periodicidad: t.periodicity || med.freq,
      ultimaAdministracion: lastAdministration,
      proximaAdministracion: nextAdministration,
      dias: daysUntil(nextAdministration),
      sitio: t.site || "—",
      statusValue: t.statusValue || "vigente",
      responsibleId: t.responsible || med.prescriber || "",
      responsable: getProf(t.responsible || med.prescriber)?.name || t.responsible || med.prescriber,
      nota: t.note || med.followup,
      status: dueStatus(nextAdministration),
    };
  });
});

const normalizeCsvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const downloadForExcel = (filename, rows) => {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(";"), ...rows.map(row => headers.map(h => normalizeCsvValue(row[h])).join(";"))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
const ExportButton = ({ rows, filename, label = "Exportar para Excel" }) => (
  <button
    onClick={() => downloadForExcel(filename, rows)}
    disabled={!rows?.length}
    className="rounded-full border border-emerald-700 bg-emerald-900/20 px-3 py-1.5 text-xs font-bold text-emerald-400 transition-colors hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
  >
    ⬇ {label}
  </button>
);

// ─── HELPERS ───────────────────────────────────────────────────────────────
const getProf = (id) => PROFESSIONALS.find(p => p.id === id);
const getRiskCfg = (r) => RISK_CONFIG[r] || RISK_CONFIG.no_evaluado;
const getStatusCfg = (s) => STATUS_CONFIG[s] || STATUS_CONFIG.activo;

const ROLE_LABELS = {
  psiquiatra_jefe:"Psiquiatra Jefe", psiquiatra:"Psiquiatra",
  medico_general:"Médico General", psicologo:"Psicólogo/a",
  terapeuta:"Terapeuta Ocupacional", enfermero:"Enfermero/a",
  trabajador_social:"Trabajador/a Social", admin:"Administrador/a"
};

// ─── PEQUEÑOS COMPONENTES ─────────────────────────────────────────────────
const RiskBadge = ({ risk, small }) => {
  const cfg = getRiskCfg(risk);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold
      ${cfg.bg} ${cfg.border} ${cfg.text} ${small ? "text-[10px] px-1.5" : ""}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}></span>
      {cfg.label}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const cfg = getStatusCfg(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
};

const ProfAvatar = ({ id, size = "sm" }) => {
  const p = getProf(id);
  if (!p) return <span className="text-slate-600 text-xs">—</span>;
  const sz = size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  return (
    <div className={`${sz} ${p.color} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`} title={p.name}>
      {p.initials}
    </div>
  );
};

const Disclaimer = () => (
  <div className="text-[10px] text-slate-500 border border-slate-700 rounded px-2 py-1 flex items-center gap-1.5 bg-slate-900/50">
    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
    Herramienta de apoyo a coordinación clínica. No reemplaza la ficha clínica oficial ni el juicio clínico profesional.
  </div>
);

// ─── SIDEBAR ───────────────────────────────────────────────────────────────
const getNavItems = () => ([
  { id:"dashboard",       label:"Dashboard",              icon:"⬡" },
  { id:"pacientes",       label:"Pacientes",              icon:"◉" },
  { id:"profesionales",   label:"Profesionales",          icon:"◈" },
  { id:"alertas",         label:"Alertas y Controles",    icon:"△", badge: ALERTS.filter(a=>a.status==="pendiente").length },
  { id:"farmacoterapia",  label:"Farmacoterapia",         icon:"⬡" },
  { id:"clozapina",       label:"Programa Clozapina",      icon:"◆", badge: getClozapineRows().filter(r=>r.dias <= 7).length },
  { id:"inyectables",     label:"Inyectables Depósito",    icon:"◇", badge: getDepotRows().filter(r=>r.dias <= 7).length },
  { id:"trazabilidad",    label:"Trazabilidad",           icon:"◫" },
  { id:"estadisticas",    label:"Estadísticas",           icon:"▦" },
  { id:"inbox",           label:"Inbox / Chat",           icon:"◻", badge: MESSAGES.filter(m=>!m.read).length },
  { id:"configuracion",   label:"Configuración",          icon:"⊙" },
]);

const Sidebar = ({ active, setActive }) => (
  <aside className="w-56 bg-[#0d1117] border-r border-slate-800 flex flex-col h-screen sticky top-0 flex-shrink-0">
    <div className="px-4 py-5 border-b border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-sky-600 rounded-lg flex items-center justify-center text-white font-black text-sm">CC</div>
        <div>
          <div className="text-white font-bold text-sm leading-none">ClinCoord</div>
          <div className="text-slate-500 text-[10px] font-medium tracking-wider uppercase">Mental Health</div>
        </div>
      </div>
    </div>
    <nav className="flex-1 py-3 overflow-y-auto">
      {getNavItems().map(item => (
        <button key={item.id} onClick={() => setActive(item.id)}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors relative
            ${active === item.id
              ? "bg-sky-600/10 text-sky-400 border-r-2 border-sky-400"
              : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"}`}>
          <span className="text-base w-4 text-center flex-shrink-0">{item.icon}</span>
          <span className="font-medium">{item.label}</span>
          {item.badge > 0 && (
            <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{item.badge}</span>
          )}
        </button>
      ))}
    </nav>
    <div className="p-3 border-t border-slate-800">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 bg-violet-600 rounded-full flex items-center justify-center text-white text-xs font-bold">VR</div>
        <div className="min-w-0">
          <div className="text-xs text-white font-medium truncate">Dra. V. Rojas</div>
          <div className="text-[10px] text-slate-500">Psiquiatra Jefe</div>
        </div>
      </div>
    </div>
  </aside>
);

// ─── TOPBAR ────────────────────────────────────────────────────────────────
const Topbar = ({ title, search, setSearch, activeInstitution, setActiveInstitution, activeUser, setActiveUser, authLocked = false, authEmail, onLogout }) => (
  <header className="h-14 bg-[#0d1117]/80 backdrop-blur-sm border-b border-slate-800 flex items-center gap-3 px-6 sticky top-0 z-10">
    <h1 className="text-slate-100 font-semibold text-base flex-shrink-0">{title}</h1>
    <InstitutionSwitcher activeInstitution={activeInstitution} setActiveInstitution={setActiveInstitution} />
    <SessionSwitcher activeUser={activeUser} setActiveUser={setActiveUser} locked={authLocked} authEmail={authEmail} onLogout={onLogout} />
    <div className="flex-1 max-w-sm ml-auto">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar paciente, profesional…"
          className="w-full bg-slate-800/60 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500" />
      </div>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="text-[10px] text-slate-600 font-mono">v1.1-MVP</div>
    </div>
  </header>
);


// ─── CAMBIO DE VERSIÓN WEB / APP MÓVIL ───────────────────────────────────
const ViewModeToggle = ({ mode, setMode }) => {
  const isMobile = mode === "mobile";
  return (
    <button
      onClick={() => setMode(isMobile ? "desktop" : "mobile")}
      className="fixed top-3 right-3 z-[80] inline-flex items-center gap-2 rounded-full border border-sky-500/60 bg-sky-600/95 px-3 py-2 text-xs font-bold text-white shadow-xl shadow-black/40 backdrop-blur hover:bg-sky-500 transition-colors"
      aria-label={isMobile ? "Cambiar a versión web" : "Cambiar a versión móvil"}
      title={isMobile ? "Cambiar a versión web" : "Cambiar a versión móvil"}
    >
      <span className="text-sm">{isMobile ? "🖥️" : "📱"}</span>
      <span>{isMobile ? "Ver web" : "Ver móvil"}</span>
    </button>
  );
};


const ThemeToggle = ({ themeMode, setThemeMode }) => {
  const isLight = themeMode === "light";
  return (
    <button
      onClick={() => setThemeMode(isLight ? "dark" : "light")}
      className="fixed top-3 right-32 z-[80] inline-flex items-center gap-2 rounded-full border border-slate-500/50 bg-slate-900/90 px-3 py-2 text-xs font-bold text-slate-100 shadow-xl shadow-black/30 backdrop-blur hover:bg-slate-800 transition-colors light-control"
      aria-label={isLight ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
      title={isLight ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}
    >
      <span className="text-sm">{isLight ? "🌙" : "☀️"}</span>
      <span>{isLight ? "Oscuro" : "Claro"}</span>
    </button>
  );
};

const InstitutionSwitcher = ({ activeInstitution, setActiveInstitution, compact = false }) => (
  <div className={`flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 p-1 ${compact ? "w-full" : "flex-shrink-0"}`}>
    {getAccessibleInstitutions().map(inst => {
      const active = inst.id === activeInstitution;
      return (
        <button
          key={inst.id}
          onClick={() => setActiveInstitution(inst.id)}
          className={`${compact ? "flex-1" : ""} inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${active ? "bg-sky-600 text-white shadow shadow-sky-950/30" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}
          title={inst.description}
        >
          <span>{inst.icon}</span>
          <span>{compact ? inst.short : inst.label}</span>
        </button>
      );
    })}
  </div>
);

const SessionSwitcher = ({ activeUser, setActiveUser, compact = false, locked = false, authEmail, onLogout }) => {
  const current = getCurrentUser();
  const options = getUserOptions();
  if (locked) {
    return (
      <div className={`flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-1 ${compact ? "w-full justify-between" : "flex-shrink-0"}`}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sesión</span>
        <span className={`${compact ? "flex-1" : "max-w-[210px]"} truncate rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100`} title={authEmail || current.name}>
          {current.id === "admin" ? "Administrador/a" : `${current.initials} · ${current.name}`}
        </span>
        <span className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-bold md:inline-flex ${current.id === "admin" ? "border-emerald-700 bg-emerald-900/20 text-emerald-400" : "border-sky-700 bg-sky-900/20 text-sky-400"}`}>
          {current.id === "admin" ? "Todo" : "Propios"}
        </span>
        {onLogout && <button onClick={onLogout} className="rounded-full border border-red-800 bg-red-900/20 px-2 py-1 text-[10px] font-bold text-red-300 hover:bg-red-900/40">Salir</button>}
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-1 ${compact ? "w-full justify-between" : "flex-shrink-0"}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Usuario</span>
      <select
        value={activeUser}
        onChange={e => setActiveUser(e.target.value)}
        className={`${compact ? "flex-1" : "max-w-[190px]"} rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-100 outline-none focus:border-sky-500`}
      >
        {options.map(user => (
          <option key={user.id} value={user.id}>{user.id === "admin" ? "Administrador/a — ve todo" : `${user.initials} · ${user.name}`}</option>
        ))}
      </select>
      <span className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-bold md:inline-flex ${current.id === "admin" ? "border-emerald-700 bg-emerald-900/20 text-emerald-400" : "border-sky-700 bg-sky-900/20 text-sky-400"}`}>
        {current.id === "admin" ? "Todo" : "Propios"}
      </span>
    </div>
  );
};

const InstitutionSummary = ({ activeInstitution }) => {
  const inst = getInstitution(activeInstitution);
  const current = getCurrentUser();
  const allInstitutionPatients = RAW_PATIENTS.filter(p => p.institution === activeInstitution).length;
  const hiddenByAccess = Math.max(allInstitutionPatients - PATIENTS.length, 0);
  return (
    <div className="rounded-2xl border border-sky-800/60 bg-sky-900/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-sky-400 font-black">Espacio institucional activo</div>
          <div className="mt-1 text-lg font-black text-slate-100">{inst.icon} {inst.label}</div>
          <div className="mt-1 text-xs text-slate-400 max-w-2xl">{inst.description}</div>
          <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs">
            <span className="font-bold text-slate-200">Sesión:</span>
            <span className="text-sky-400">{current.name}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${current.id === "admin" ? "border-emerald-700 bg-emerald-900/20 text-emerald-400" : "border-sky-700 bg-sky-900/20 text-sky-400"}`}>
              {current.id === "admin" ? "Administrador · ve todos" : "Profesional · solo pacientes propios"}
            </span>
            {hiddenByAccess > 0 && <span className="text-slate-500">{hiddenByAccess} caso(s) ocultos por permisos demo</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
            <div className="text-lg font-black text-sky-400">{PATIENTS.length}</div>
            <div className="text-[10px] text-slate-500">Pacientes visibles</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
            <div className="text-lg font-black text-violet-400">{PROFESSIONALS.length}</div>
            <div className="text-[10px] text-slate-500">Equipo visible</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
            <div className="text-lg font-black text-red-400">{ALERTS.filter(a => a.status !== "resuelto").length}</div>
            <div className="text-[10px] text-slate-500">Alertas visibles</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const MobileTopbar = ({ title, search, setSearch, activeInstitution, setActiveInstitution, activeUser, setActiveUser, authLocked = false, authEmail, onLogout }) => (
  <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0d1117]/95 px-4 pt-4 pb-3 shadow-lg shadow-black/30 backdrop-blur-xl">
    <div className="pr-28">
      <div className="text-[10px] uppercase tracking-[0.22em] text-sky-400 font-bold">ClinCoord · App móvil</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <div className="text-xl font-black text-white leading-tight">{title}</div>
          <div className="text-[11px] text-slate-500">Vista compacta para celular</div>
        </div>
      </div>
    </div>
    <div className="mt-3 space-y-2">
      <InstitutionSwitcher activeInstitution={activeInstitution} setActiveInstitution={setActiveInstitution} compact />
      <SessionSwitcher activeUser={activeUser} setActiveUser={setActiveUser} compact locked={authLocked} authEmail={authEmail} onLogout={onLogout} />
    </div>
    <div className="relative mt-3">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar paciente, diagnóstico o profesional…"
        className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 py-3 pl-10 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
      />
    </div>
  </header>
);

const MobileBottomNav = ({ active, setActive }) => (
  <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-[430px] -translate-x-1/2 border-t border-slate-800 bg-[#0d1117]/95 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-2xl shadow-black/60 backdrop-blur-xl">
    <div className="flex gap-1 overflow-x-auto">
      {getNavItems().map(item => (
        <button
          key={item.id}
          onClick={() => setActive(item.id)}
          className={`relative flex min-w-[74px] flex-col items-center justify-center rounded-2xl px-2 py-2 text-[10px] font-semibold transition-colors ${
            active === item.id
              ? "bg-sky-600 text-white shadow-lg shadow-sky-950/40"
              : "text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          }`}
        >
          <span className="text-base leading-none">{item.icon}</span>
          <span className="mt-1 max-w-[66px] truncate">{item.label.split(" ")[0]}</span>
          {item.badge > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white">{item.badge}</span>
          )}
        </button>
      ))}
    </div>
  </nav>
);


// ─── FORMULARIOS REALES SUPABASE: PACIENTES Y EQUIPO ──────────────────────
const emptyToNull = (value) => {
  const v = String(value ?? "").trim();
  return v ? v : null;
};
const parseOptionalInt = (value) => {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const parseOptionalNumber = (value) => {
  const v = String(value ?? "").trim().replace(",", ".");
  if (!v) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const calculateNextDate = (date, days) => {
  const d = emptyToNull(date);
  const n = parseOptionalInt(days);
  if (!d || !n) return "";
  return addDays(d, n);
};
const CLINICAL_PROGRAM_STATUS_OPTIONS = ["vigente", "proximo", "atrasado", "suspendido"];
const inferProgramStatus = (nextDate) => {
  const d = daysUntil(nextDate);
  if (d < 0) return "atrasado";
  if (d <= 7) return "proximo";
  return "vigente";
};
const splitSecondaryDx = (value) => String(value ?? "")
  .split(/[;\n]/)
  .map(v => v.trim())
  .filter(Boolean);

const TEAM_FIELD_CONFIG = [
  { field:"doctor",       label:"Psiquiatra / Médico",  teamRole:"psiquiatra",              allowed:["psiquiatra_jefe","psiquiatra","medico_general"] },
  { field:"psychologist", label:"Psicólogo/a",          teamRole:"psicologo",               allowed:["psicologo"] },
  { field:"ot",           label:"Terapia ocupacional",  teamRole:"terapeuta_ocupacional",   allowed:["terapeuta","terapeuta_ocupacional"] },
  { field:"nurse",        label:"Enfermería",           teamRole:"enfermero",               allowed:["enfermero"] },
  { field:"social",       label:"Trabajo social",       teamRole:"trabajador_social",       allowed:["trabajador_social"] },
];

const getTeamOptionsForField = (field) => {
  const cfg = TEAM_FIELD_CONFIG.find(x => x.field === field);
  const allowed = cfg?.allowed || [];
  return RAW_PROFESSIONALS
    .filter(p => p.institution === ACTIVE_INSTITUTION_ID && p.is_active !== false && allowed.includes(p.role))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getInstitutionIdForWorkspace = async (workspaceId) => {
  const { data, error } = await supabase
    .from("institutions")
    .select("id")
    .eq("slug", workspaceToInstitutionSlug(workspaceId))
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error("No se encontró la institución activa en Supabase.");
  return data.id;
};

const getCurrentDbProfile = async (authSession, workspaceId = ACTIVE_INSTITUTION_ID) => {
  if (!authSession?.user?.id) throw new Error("No hay sesión activa.");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,is_active")
    .eq("id", authSession.user.id)
    .single();
  if (profileError) throw profileError;
  if (!profile?.id) throw new Error("Tu usuario no tiene perfil en Supabase.");
  if (profile.is_active === false) throw new Error("Tu perfil está desactivado.");

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("id,institution_id,professional_id,role,is_default,is_active,institutions(id,slug,kind,name)")
    .eq("user_id", authSession.user.id)
    .eq("is_active", true);
  if (membershipError) throw membershipError;
  if (!memberships?.length) throw new Error("Tu usuario no tiene membresías institucionales activas.");

  const membership = memberships.find(m => normalizeWorkspaceId(m.institutions) === workspaceId)
    || memberships.find(m => m.is_default)
    || memberships[0];
  if (!membership) throw new Error("No tienes acceso a esta institución.");

  return {
    ...profile,
    role: membership.role,
    institution_id: membership.institution_id,
    professional_id: membership.professional_id,
    institutions: membership.institutions,
    membership_id: membership.id,
  };
};

const insertTraceEvent = async ({ institutionId, patientId, authSession, action, field, previousValue, nextValue, eventType = "edicion" }) => {
  if (!isSupabaseConfigured || !authSession?.user?.id || !institutionId || !patientId) return;
  await supabase.from("trace_events").insert({
    institution_id: institutionId,
    patient_id: patientId,
    actor_profile_id: authSession.user.id,
    action,
    field,
    previous_value: previousValue ?? null,
    next_value: nextValue ?? null,
    event_type: eventType,
  });
};

const buildPatientPayload = (form, institutionId, authSession, includeCreatedBy = false) => {
  const payload = {
    institution_id: institutionId,
    clinical_code: String(form.clinical_code || "").trim().toUpperCase(),
    initials: String(form.initials || "").trim().toUpperCase(),
    age: parseOptionalInt(form.age),
    gender: form.gender || "NR",
    dx_main: emptyToNull(form.dx_main),
    dx_secondary: splitSecondaryDx(form.dx_secondary),
    risk: form.risk || "no_evaluado",
    status: form.status || "activo",
    suicide_risk: form.suicide_risk || "no_evaluado",
    hetero_risk: form.hetero_risk || "no_evaluado",
    social_risk: form.social_risk || "no_evaluado",
    substances: emptyToNull(form.substances),
    adherence: emptyToNull(form.adherence),
    functional_status: emptyToNull(form.functional_status),
    support_network: emptyToNull(form.support_network),
    admission_date: emptyToNull(form.admission_date),
    last_contact_date: emptyToNull(form.last_contact_date),
    next_control_date: emptyToNull(form.next_control_date),
    notes: emptyToNull(form.notes),
  };
  if (includeCreatedBy) payload.created_by = authSession?.user?.id || null;
  return payload;
};

const buildTeamRows = (patientId, team) => TEAM_FIELD_CONFIG
  .map(cfg => ({ cfg, professionalId: team[cfg.field] }))
  .filter(item => Boolean(item.professionalId))
  .map(item => ({
    patient_id: patientId,
    professional_id: item.professionalId,
    team_role: item.cfg.teamRole,
    is_primary: item.cfg.field === "doctor",
  }));

const buildTeamRowsForRpc = (team) => TEAM_FIELD_CONFIG
  .map(cfg => ({ cfg, professionalId: team[cfg.field] }))
  .filter(item => Boolean(item.professionalId))
  .map(item => ({
    professional_id: item.professionalId,
    team_role: item.cfg.teamRole,
    is_primary: item.cfg.field === "doctor",
  }));

const savePatientToSupabase = async ({ mode, patient, form, team, activeInstitution, authSession, authProfile }) => {
  if (!isSupabaseConfigured) throw new Error("Esta acción requiere Supabase configurado.");
  if (!authSession?.user?.id) throw new Error("No hay sesión activa.");

  // v1.6: la institución se toma desde la membresía activa seleccionada en la app.
  // Una misma cuenta puede tener varias instituciones, cada una con rol propio.
  const dbProfile = await getCurrentDbProfile(authSession, activeInstitution || ACTIVE_INSTITUTION_ID);
  const isAdmin = dbProfile.role === "admin";
  const institutionId = dbProfile.institution_id;

  const payload = buildPatientPayload(form, institutionId, authSession, mode === "create");
  if (!payload.clinical_code) throw new Error("El código clínico es obligatorio.");
  if (!payload.initials) throw new Error("Las iniciales son obligatorias.");

  if (mode === "create") {
    if (!isAdmin) throw new Error("Solo un administrador de la institución puede crear pacientes nuevos. Entra con admin@clincoord.demo o h-admin@clincoord.demo.");

    // v1.6: la creación se hace por RPC multi-institución.
    // La función recibe explícitamente la institución activa y Supabase valida
    // que el usuario sea admin de esa institución mediante memberships.
    const { data, error } = await supabase.rpc("clincoord_create_patient_v2", {
      p_institution_id: institutionId,
      p_clinical_code: payload.clinical_code,
      p_initials: payload.initials,
      p_age: payload.age,
      p_gender: payload.gender,
      p_dx_main: payload.dx_main,
      p_dx_secondary: payload.dx_secondary,
      p_risk: payload.risk,
      p_status: payload.status,
      p_suicide_risk: payload.suicide_risk,
      p_hetero_risk: payload.hetero_risk,
      p_social_risk: payload.social_risk,
      p_substances: payload.substances,
      p_adherence: payload.adherence,
      p_functional_status: payload.functional_status,
      p_support_network: payload.support_network,
      p_admission_date: payload.admission_date,
      p_last_contact_date: payload.last_contact_date,
      p_next_control_date: payload.next_control_date,
      p_notes: payload.notes,
      p_team: buildTeamRowsForRpc(team),
    });
    if (error) throw error;

    if (!data) throw new Error("El paciente fue creado, pero Supabase no devolvió su identificador.");
    return { id: data, clinical_code: payload.clinical_code };
  }

  if (!patient?._dbId) throw new Error("Este paciente no tiene identificador de base de datos.");
  const { error } = await supabase
    .from("patients")
    .update(payload)
    .eq("id", patient._dbId);
  if (error) throw error;

  if (isAdmin) {
    const { error: deleteTeamError } = await supabase
      .from("patient_team")
      .delete()
      .eq("patient_id", patient._dbId);
    if (deleteTeamError) throw deleteTeamError;
    const teamRows = buildTeamRows(patient._dbId, team);
    if (teamRows.length) {
      const { error: teamError } = await supabase.from("patient_team").insert(teamRows);
      if (teamError) throw teamError;
    }
  }

  await insertTraceEvent({
    institutionId,
    patientId: patient._dbId,
    authSession,
    action: "Paciente actualizado desde app",
    field: "resumen",
    previousValue: patient.id,
    nextValue: payload.clinical_code,
    eventType: "edicion",
  });
  return { id: patient._dbId, clinical_code: payload.clinical_code };
};

const defaultPatientForm = () => ({
  clinical_code:"",
  initials:"",
  age:"",
  gender:"NR",
  dx_main:"",
  dx_secondary:"",
  risk:"no_evaluado",
  status:"activo",
  suicide_risk:"no_evaluado",
  hetero_risk:"no_evaluado",
  social_risk:"no_evaluado",
  substances:"",
  adherence:"",
  functional_status:"",
  support_network:"",
  admission_date:new Date().toISOString().slice(0, 10),
  last_contact_date:new Date().toISOString().slice(0, 10),
  next_control_date:"",
  notes:"",
});

const patientToForm = (patient) => ({
  clinical_code: patient?.id || "",
  initials: patient?.initials || "",
  age: patient?.age ?? "",
  gender: patient?.gender || "NR",
  dx_main: patient?.dx_main || "",
  dx_secondary: Array.isArray(patient?.dx_secondary) ? patient.dx_secondary.join("; ") : "",
  risk: patient?.risk || "no_evaluado",
  status: patient?.status || "activo",
  suicide_risk: patient?.suicide_risk || "no_evaluado",
  hetero_risk: patient?.hetero_risk || "no_evaluado",
  social_risk: patient?.social_risk || "no_evaluado",
  substances: patient?.substances === "—" ? "" : patient?.substances || "",
  adherence: patient?.adherence === "—" ? "" : patient?.adherence || "",
  functional_status: patient?.functional === "—" ? "" : patient?.functional || "",
  support_network: patient?.support === "—" ? "" : patient?.support || "",
  admission_date: patient?.admission || "",
  last_contact_date: patient?.last_contact || "",
  next_control_date: patient?.next_control || "",
  notes: patient?.notes || "",
});

const patientToTeam = (patient) => ({
  doctor: patient?.doctor || "",
  psychologist: patient?.psychologist || "",
  ot: patient?.ot || "",
  nurse: patient?.nurse || "",
  social: patient?.social || "",
});

const FieldLabel = ({ children }) => <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{children}</label>;
const TextInput = ({ value, onChange, type="text", placeholder="", required=false }) => (
  <input
    type={type}
    value={value ?? ""}
    required={required}
    placeholder={placeholder}
    onChange={e => onChange(e.target.value)}
    className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
  />
);
const SelectInput = ({ value, onChange, children, disabled=false }) => (
  <select
    value={value ?? ""}
    disabled={disabled}
    onChange={e => onChange(e.target.value)}
    className="w-full rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
  >
    {children}
  </select>
);
const TextAreaInput = ({ value, onChange, rows=3, placeholder="" }) => (
  <textarea
    value={value ?? ""}
    rows={rows}
    placeholder={placeholder}
    onChange={e => onChange(e.target.value)}
    className="w-full resize-none rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500"
  />
);

const PatientFormModal = ({ mode, patient, authSession, authProfile, activeInstitution, onClose, onSaved }) => {
  const [form, setForm] = useState(() => mode === "edit" ? patientToForm(patient) : defaultPatientForm());
  const [team, setTeam] = useState(() => mode === "edit" ? patientToTeam(patient) : patientToTeam(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = (getMembershipForWorkspace(ACTIVE_INSTITUTION_ID)?.role === "admin" || ACTIVE_USER_ID === "admin");
  const canManageTeam = isAdmin;
  const canCreate = mode !== "create" || isAdmin;
  const updateForm = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const updateTeam = (key, value) => setTeam(prev => ({ ...prev, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await savePatientToSupabase({ mode, patient, form, team, activeInstitution, authSession, authProfile });
      await onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err?.message || "No se pudo guardar el paciente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} className="my-4 w-full max-w-4xl rounded-3xl border border-slate-700 bg-[#0d1117] shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-3xl border-b border-slate-800 bg-[#131920]/95 p-5 backdrop-blur">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-sky-400 font-black">Etapa 6.1 · Pacientes reales</div>
            <h2 className="mt-1 text-xl font-black text-white">{mode === "create" ? "Nuevo paciente" : `Editar ${patient?.id}`}</h2>
            <p className="mt-1 text-xs text-slate-400">Guarda en Supabase. El equipo tratante controla qué profesionales podrán ver el caso.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-300 hover:bg-slate-800">✕</button>
        </div>

        <div className="space-y-5 p-5">
          {!canCreate && (
            <div className="rounded-2xl border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">
              En esta versión, por seguridad, solo el administrador puede crear pacientes nuevos. Los profesionales pueden editar casos que ya tienen asignados.
            </div>
          )}
          {error && <div className="rounded-2xl border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}

          <section className="rounded-2xl border border-slate-800 bg-[#131920] p-4">
            <div className="mb-3 text-sm font-black text-slate-100">Datos básicos</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><FieldLabel>Código clínico</FieldLabel><TextInput required value={form.clinical_code} onChange={v => updateForm("clinical_code", v)} placeholder="CMP-005" /></div>
              <div><FieldLabel>Iniciales</FieldLabel><TextInput required value={form.initials} onChange={v => updateForm("initials", v)} placeholder="A.B.C." /></div>
              <div><FieldLabel>Edad</FieldLabel><TextInput type="number" value={form.age} onChange={v => updateForm("age", v)} /></div>
              <div><FieldLabel>Género</FieldLabel><SelectInput value={form.gender} onChange={v => updateForm("gender", v)}><option value="NR">No registrado</option><option value="F">F</option><option value="M">M</option><option value="X">X</option></SelectInput></div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div><FieldLabel>Diagnóstico principal</FieldLabel><TextAreaInput rows={2} value={form.dx_main} onChange={v => updateForm("dx_main", v)} placeholder="Diagnóstico de trabajo" /></div>
              <div><FieldLabel>Diagnósticos secundarios</FieldLabel><TextAreaInput rows={2} value={form.dx_secondary} onChange={v => updateForm("dx_secondary", v)} placeholder="Separar con punto y coma" /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-[#131920] p-4">
            <div className="mb-3 text-sm font-black text-slate-100">Riesgo, estado y seguimiento</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><FieldLabel>Riesgo global</FieldLabel><SelectInput value={form.risk} onChange={v => updateForm("risk", v)}>{["critico","alto","medio","bajo","no_evaluado"].map(x => <option key={x} value={x}>{getRiskCfg(x).label}</option>)}</SelectInput></div>
              <div><FieldLabel>Estado</FieldLabel><SelectInput value={form.status} onChange={v => updateForm("status", v)}>{Object.entries(STATUS_CONFIG).map(([k,c]) => <option key={k} value={k}>{c.label}</option>)}</SelectInput></div>
              <div><FieldLabel>Riesgo suicida</FieldLabel><SelectInput value={form.suicide_risk} onChange={v => updateForm("suicide_risk", v)}>{["critico","alto","medio","bajo","no_evaluado"].map(x => <option key={x} value={x}>{getRiskCfg(x).label}</option>)}</SelectInput></div>
              <div><FieldLabel>Riesgo social</FieldLabel><SelectInput value={form.social_risk} onChange={v => updateForm("social_risk", v)}>{["critico","alto","medio","bajo","no_evaluado"].map(x => <option key={x} value={x}>{getRiskCfg(x).label}</option>)}</SelectInput></div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div><FieldLabel>Riesgo heteroagresivo</FieldLabel><SelectInput value={form.hetero_risk} onChange={v => updateForm("hetero_risk", v)}>{["critico","alto","medio","bajo","no_evaluado"].map(x => <option key={x} value={x}>{getRiskCfg(x).label}</option>)}</SelectInput></div>
              <div><FieldLabel>Ingreso</FieldLabel><TextInput type="date" value={form.admission_date} onChange={v => updateForm("admission_date", v)} /></div>
              <div><FieldLabel>Último contacto</FieldLabel><TextInput type="date" value={form.last_contact_date} onChange={v => updateForm("last_contact_date", v)} /></div>
              <div><FieldLabel>Próximo control</FieldLabel><TextInput type="date" value={form.next_control_date} onChange={v => updateForm("next_control_date", v)} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-[#131920] p-4">
            <div className="mb-3 text-sm font-black text-slate-100">Contexto clínico-funcional</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div><FieldLabel>Sustancias</FieldLabel><TextInput value={form.substances} onChange={v => updateForm("substances", v)} /></div>
              <div><FieldLabel>Adherencia</FieldLabel><TextInput value={form.adherence} onChange={v => updateForm("adherence", v)} /></div>
              <div><FieldLabel>Estado funcional</FieldLabel><TextInput value={form.functional_status} onChange={v => updateForm("functional_status", v)} /></div>
              <div><FieldLabel>Red de apoyo</FieldLabel><TextInput value={form.support_network} onChange={v => updateForm("support_network", v)} /></div>
            </div>
            <div className="mt-3"><FieldLabel>Observaciones de gestión</FieldLabel><TextAreaInput rows={4} value={form.notes} onChange={v => updateForm("notes", v)} /></div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-[#131920] p-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="text-sm font-black text-slate-100">Equipo tratante</div>
              {!canManageTeam && <span className="rounded-full border border-amber-700 bg-amber-950/30 px-2 py-1 text-[10px] font-bold text-amber-300">Solo admin puede reasignar equipo</span>}
            </div>
            <p className="mb-3 text-xs text-slate-500">El paciente será visible para los profesionales asignados aquí.</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {TEAM_FIELD_CONFIG.map(cfg => (
                <div key={cfg.field}>
                  <FieldLabel>{cfg.label}</FieldLabel>
                  <SelectInput disabled={!canManageTeam} value={team[cfg.field]} onChange={v => updateTeam(cfg.field, v)}>
                    <option value="">Sin asignar</option>
                    {getTeamOptionsForField(cfg.field).map(prof => <option key={prof.id} value={prof.id}>{prof.name} · {ROLE_LABELS[prof.role] || prof.role}</option>)}
                  </SelectInput>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 rounded-b-3xl border-t border-slate-800 bg-[#0d1117]/95 p-4 backdrop-blur">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={saving || !canCreate} className="rounded-2xl bg-sky-600 px-5 py-2 text-sm font-black text-white shadow-lg shadow-sky-950/40 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Guardando…" : mode === "create" ? "Crear paciente" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
};


// ─── FORMULARIOS REALES SUPABASE: CLOZAPINA E INYECTABLES ────────────────
const getResponsibleOptions = () => RAW_PROFESSIONALS
  .filter(p => p.institution === ACTIVE_INSTITUTION_ID && p.is_active !== false && p.role !== "admin")
  .sort((a, b) => a.name.localeCompare(b.name));

const getVisiblePatientOptions = () => PATIENTS
  .filter(p => p.institution === ACTIVE_INSTITUTION_ID && p._dbId)
  .sort((a, b) => a.id.localeCompare(b.id));

const clozapineDefaultForm = (row = null) => ({
  patient_id: row?.patientDbId || "",
  program_id: row?.programDbId || "",
  medication_id: row?.medicationDbId || "",
  dose: row?.dosis || "",
  scheme: row?.esquema || "0-0-1",
  start_date: row?.startDate || todayIso(),
  cbc_frequency_days: row?.periodDays || 30,
  last_cbc_date: row?.ultimoHemograma || todayIso(),
  next_cbc_date: row?.proximoHemograma || calculateNextDate(todayIso(), 30),
  leukocytes: row?.leucocitos === "—" ? "" : row?.leucocitos || "",
  neutrophils: row?.neutrofilos === "—" ? "" : row?.neutrofilos || "",
  status: row?.statusValue || inferProgramStatus(row?.proximoHemograma || calculateNextDate(todayIso(), 30)),
  responsible_professional_id: row?.responsibleId || "",
  notes: row?.nota || "",
});

const laiDefaultForm = (row = null) => ({
  patient_id: row?.patientDbId || "",
  program_id: row?.programDbId || "",
  medication_id: row?.medicationDbId || "",
  drug: row?.farmaco || "",
  dose: row?.dosis || "",
  interval_days: row?.intervalDays || 28,
  route: row?.route || "IM",
  last_administration_date: row?.ultimaAdministracion || todayIso(),
  next_administration_date: row?.proximaAdministracion || calculateNextDate(todayIso(), 28),
  administration_site: row?.sitio === "—" ? "" : row?.sitio || "",
  status: row?.statusValue || inferProgramStatus(row?.proximaAdministracion || calculateNextDate(todayIso(), 28)),
  responsible_professional_id: row?.responsibleId || "",
  notes: row?.nota || "",
});

const ensureMedicationForProgram = async ({ institutionId, patientId, medicationId, program, drug, dose, scheme, frequency, startDate, nextControlDate, responsibleId, followup }) => {
  const payload = {
    institution_id: institutionId,
    patient_id: patientId,
    drug,
    dose: emptyToNull(dose),
    scheme: emptyToNull(scheme),
    frequency: emptyToNull(frequency),
    start_date: emptyToNull(startDate),
    next_control_date: emptyToNull(nextControlDate),
    prescriber_professional_id: emptyToNull(responsibleId),
    followup: emptyToNull(followup),
    program,
    is_active: true,
  };

  if (medicationId && !String(medicationId).startsWith("lai_")) {
    const { data, error } = await supabase
      .from("medications")
      .update(payload)
      .eq("id", medicationId)
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  const { data, error } = await supabase
    .from("medications")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
};

const saveClozapineProgramToSupabase = async ({ form, row, authSession }) => {
  if (!isSupabaseConfigured) throw new Error("Esta acción requiere Supabase configurado.");
  const dbProfile = await getCurrentDbProfile(authSession);
  const institutionId = dbProfile.institution_id;
  const patientId = emptyToNull(form.patient_id);
  if (!patientId) throw new Error("Selecciona un paciente.");
  if (!emptyToNull(form.dose)) throw new Error("La dosis es obligatoria.");

  const nextDate = emptyToNull(form.next_cbc_date) || calculateNextDate(form.last_cbc_date, form.cbc_frequency_days);
  const status = form.status || inferProgramStatus(nextDate);
  const medicationId = await ensureMedicationForProgram({
    institutionId,
    patientId,
    medicationId: form.medication_id,
    program: "clozapine",
    drug: "Clozapina",
    dose: form.dose,
    scheme: form.scheme,
    frequency: `Cada ${parseOptionalInt(form.cbc_frequency_days) || 30} días hemograma`,
    startDate: form.start_date,
    nextControlDate: nextDate,
    responsibleId: form.responsible_professional_id,
    followup: "Programa Clozapina: seguimiento hematológico obligatorio.",
  });

  const payload = {
    institution_id: institutionId,
    patient_id: patientId,
    medication_id: medicationId,
    dose: emptyToNull(form.dose),
    scheme: emptyToNull(form.scheme),
    start_date: emptyToNull(form.start_date),
    cbc_frequency_days: parseOptionalInt(form.cbc_frequency_days) || 30,
    last_cbc_date: emptyToNull(form.last_cbc_date),
    next_cbc_date: nextDate,
    leukocytes: parseOptionalNumber(form.leukocytes),
    neutrophils: parseOptionalNumber(form.neutrophils),
    status,
    responsible_professional_id: emptyToNull(form.responsible_professional_id),
    notes: emptyToNull(form.notes),
    is_active: status !== "suspendido",
  };

  const existingId = form.program_id || row?.programDbId || null;
  let saved;
  if (existingId) {
    const { data, error } = await supabase
      .from("clozapine_programs")
      .update(payload)
      .eq("id", existingId)
      .select("id,patient_id")
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const { data: existing } = await supabase
      .from("clozapine_programs")
      .select("id")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from("clozapine_programs")
        .update(payload)
        .eq("id", existing.id)
        .select("id,patient_id")
        .single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase
        .from("clozapine_programs")
        .insert(payload)
        .select("id,patient_id")
        .single();
      if (error) throw error;
      saved = data;
    }
  }

  await insertTraceEvent({
    institutionId,
    patientId,
    authSession,
    action: "Programa clozapina actualizado desde app",
    field: "clozapine_programs.next_cbc_date",
    previousValue: row?.proximoHemograma || null,
    nextValue: nextDate,
    eventType: "edicion",
  });
  return saved;
};

const saveLaiProgramToSupabase = async ({ form, row, authSession }) => {
  if (!isSupabaseConfigured) throw new Error("Esta acción requiere Supabase configurado.");
  const dbProfile = await getCurrentDbProfile(authSession);
  const institutionId = dbProfile.institution_id;
  const patientId = emptyToNull(form.patient_id);
  if (!patientId) throw new Error("Selecciona un paciente.");
  if (!emptyToNull(form.drug)) throw new Error("El fármaco es obligatorio.");

  const intervalDays = parseOptionalInt(form.interval_days) || 28;
  const nextDate = emptyToNull(form.next_administration_date) || calculateNextDate(form.last_administration_date, intervalDays);
  const status = form.status || inferProgramStatus(nextDate);
  const medicationId = await ensureMedicationForProgram({
    institutionId,
    patientId,
    medicationId: form.medication_id,
    program: "lai",
    drug: form.drug,
    dose: form.dose,
    scheme: `${form.route || "IM"}/${intervalDays}d`,
    frequency: `Cada ${intervalDays} días`,
    startDate: form.last_administration_date,
    nextControlDate: nextDate,
    responsibleId: form.responsible_professional_id,
    followup: "Programa inyectables de depósito / LAI.",
  });

  const payload = {
    institution_id: institutionId,
    patient_id: patientId,
    medication_id: medicationId,
    drug: emptyToNull(form.drug),
    dose: emptyToNull(form.dose),
    interval_days: intervalDays,
    route: emptyToNull(form.route) || "IM",
    last_administration_date: emptyToNull(form.last_administration_date),
    next_administration_date: nextDate,
    administration_site: emptyToNull(form.administration_site),
    status,
    responsible_professional_id: emptyToNull(form.responsible_professional_id),
    notes: emptyToNull(form.notes),
    is_active: status !== "suspendido",
  };

  const existingId = form.program_id || row?.programDbId || null;
  let saved;
  if (existingId) {
    const { data, error } = await supabase
      .from("lai_programs")
      .update(payload)
      .eq("id", existingId)
      .select("id,patient_id")
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const { data: existing } = await supabase
      .from("lai_programs")
      .select("id")
      .eq("patient_id", patientId)
      .eq("drug", form.drug)
      .maybeSingle();
    if (existing?.id) {
      const { data, error } = await supabase
        .from("lai_programs")
        .update(payload)
        .eq("id", existing.id)
        .select("id,patient_id")
        .single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase
        .from("lai_programs")
        .insert(payload)
        .select("id,patient_id")
        .single();
      if (error) throw error;
      saved = data;
    }
  }

  await insertTraceEvent({
    institutionId,
    patientId,
    authSession,
    action: "Programa inyectable de depósito actualizado desde app",
    field: "lai_programs.next_administration_date",
    previousValue: row?.proximaAdministracion || null,
    nextValue: nextDate,
    eventType: "edicion",
  });
  return saved;
};

const ClinicalProgramModal = ({ type, row, authSession, onClose, onSaved }) => {
  const isClozapine = type === "clozapine";
  const [form, setForm] = useState(() => isClozapine ? clozapineDefaultForm(row) : laiDefaultForm(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const patientOptions = getVisiblePatientOptions();
  const responsibleOptions = getResponsibleOptions();
  const updateForm = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const recalcNext = () => {
    if (isClozapine) {
      const next = calculateNextDate(form.last_cbc_date, form.cbc_frequency_days);
      setForm(prev => ({ ...prev, next_cbc_date: next, status: inferProgramStatus(next) }));
    } else {
      const next = calculateNextDate(form.last_administration_date, form.interval_days);
      setForm(prev => ({ ...prev, next_administration_date: next, status: inferProgramStatus(next) }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (isClozapine) await saveClozapineProgramToSupabase({ form, row, authSession });
      else await saveLaiProgramToSupabase({ form, row, authSession });
      await onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err?.message || "No se pudo guardar el programa clínico.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} className="my-4 w-full max-w-3xl rounded-3xl border border-slate-700 bg-[#0d1117] shadow-2xl shadow-black/50" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-3xl border-b border-slate-800 bg-[#131920]/95 p-5 backdrop-blur">
          <div>
            <div className={`text-[10px] uppercase tracking-[0.22em] font-black ${isClozapine ? "text-red-400" : "text-violet-400"}`}>Etapa 6.4 · Programas reales</div>
            <h2 className="mt-1 text-xl font-black text-white">{isClozapine ? "Seguimiento Clozapina" : "Inyectable de depósito / LAI"}</h2>
            <p className="mt-1 text-xs text-slate-400">Guarda en Supabase y deja trazabilidad automática del cambio.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-700 px-3 py-1.5 text-sm font-bold text-slate-300 hover:bg-slate-800">✕</button>
        </div>

        <div className="space-y-5 p-5">
          {error && <div className="rounded-2xl border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}

          <section className="rounded-2xl border border-slate-800 bg-[#131920] p-4">
            <div className="mb-3 text-sm font-black text-slate-100">Paciente y responsable</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <FieldLabel>Paciente visible</FieldLabel>
                <SelectInput disabled={Boolean(row?.patientDbId)} value={form.patient_id} onChange={v => updateForm("patient_id", v)}>
                  <option value="">Seleccionar paciente</option>
                  {patientOptions.map(p => <option key={p._dbId} value={p._dbId}>{p.id} · {p.initials} · {p.dx_main}</option>)}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Responsable</FieldLabel>
                <SelectInput value={form.responsible_professional_id} onChange={v => updateForm("responsible_professional_id", v)}>
                  <option value="">Sin responsable</option>
                  {responsibleOptions.map(prof => <option key={prof.id} value={prof.id}>{prof.name} · {ROLE_LABELS[prof.role] || prof.role}</option>)}
                </SelectInput>
              </div>
            </div>
          </section>

          {isClozapine ? (
            <section className="rounded-2xl border border-red-900/50 bg-red-950/10 p-4">
              <div className="mb-3 text-sm font-black text-slate-100">Clozapina y hemograma</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div><FieldLabel>Dosis</FieldLabel><TextInput required value={form.dose} onChange={v => updateForm("dose", v)} placeholder="150 mg" /></div>
                <div><FieldLabel>Esquema</FieldLabel><TextInput value={form.scheme} onChange={v => updateForm("scheme", v)} placeholder="0-0-1" /></div>
                <div><FieldLabel>Inicio clozapina</FieldLabel><TextInput type="date" value={form.start_date} onChange={v => updateForm("start_date", v)} /></div>
                <div><FieldLabel>Periodicidad hemograma (días)</FieldLabel><TextInput type="number" value={form.cbc_frequency_days} onChange={v => updateForm("cbc_frequency_days", v)} /></div>
                <div><FieldLabel>Último hemograma</FieldLabel><TextInput type="date" value={form.last_cbc_date} onChange={v => updateForm("last_cbc_date", v)} /></div>
                <div><FieldLabel>Próximo hemograma</FieldLabel><TextInput type="date" value={form.next_cbc_date} onChange={v => updateForm("next_cbc_date", v)} /></div>
                <div><FieldLabel>Leucocitos</FieldLabel><TextInput value={form.leukocytes} onChange={v => updateForm("leukocytes", v)} placeholder="6200" /></div>
                <div><FieldLabel>Neutrófilos / RAN</FieldLabel><TextInput value={form.neutrophils} onChange={v => updateForm("neutrophils", v)} placeholder="3400" /></div>
                <div><FieldLabel>Estado</FieldLabel><SelectInput value={form.status} onChange={v => updateForm("status", v)}>{CLINICAL_PROGRAM_STATUS_OPTIONS.map(x => <option key={x} value={x}>{x}</option>)}</SelectInput></div>
              </div>
              <button type="button" onClick={recalcNext} className="mt-3 rounded-xl border border-red-700 bg-red-950/30 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-900/30">Calcular próximo hemograma</button>
              <div className="mt-3"><FieldLabel>Notas</FieldLabel><TextAreaInput rows={3} value={form.notes} onChange={v => updateForm("notes", v)} /></div>
            </section>
          ) : (
            <section className="rounded-2xl border border-violet-900/50 bg-violet-950/10 p-4">
              <div className="mb-3 text-sm font-black text-slate-100">Inyectable de depósito</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div><FieldLabel>Fármaco</FieldLabel><TextInput required value={form.drug} onChange={v => updateForm("drug", v)} placeholder="Paliperidona / Risperidona LAI" /></div>
                <div><FieldLabel>Dosis</FieldLabel><TextInput value={form.dose} onChange={v => updateForm("dose", v)} placeholder="100 mg" /></div>
                <div><FieldLabel>Vía</FieldLabel><TextInput value={form.route} onChange={v => updateForm("route", v)} placeholder="IM" /></div>
                <div><FieldLabel>Periodicidad (días)</FieldLabel><TextInput type="number" value={form.interval_days} onChange={v => updateForm("interval_days", v)} /></div>
                <div><FieldLabel>Última administración</FieldLabel><TextInput type="date" value={form.last_administration_date} onChange={v => updateForm("last_administration_date", v)} /></div>
                <div><FieldLabel>Próxima administración</FieldLabel><TextInput type="date" value={form.next_administration_date} onChange={v => updateForm("next_administration_date", v)} /></div>
                <div><FieldLabel>Sitio administración</FieldLabel><TextInput value={form.administration_site} onChange={v => updateForm("administration_site", v)} placeholder="Deltoides izquierdo" /></div>
                <div><FieldLabel>Estado</FieldLabel><SelectInput value={form.status} onChange={v => updateForm("status", v)}>{CLINICAL_PROGRAM_STATUS_OPTIONS.map(x => <option key={x} value={x}>{x}</option>)}</SelectInput></div>
              </div>
              <button type="button" onClick={recalcNext} className="mt-3 rounded-xl border border-violet-700 bg-violet-950/30 px-3 py-2 text-xs font-bold text-violet-300 hover:bg-violet-900/30">Calcular próxima administración</button>
              <div className="mt-3"><FieldLabel>Notas</FieldLabel><TextAreaInput rows={3} value={form.notes} onChange={v => updateForm("notes", v)} /></div>
            </section>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 rounded-b-3xl border-t border-slate-800 bg-[#0d1117]/95 p-4 backdrop-blur">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-sky-600 px-5 py-2 text-sm font-black text-white shadow-lg shadow-sky-950/40 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar programa"}
          </button>
        </div>
      </form>
    </div>
  );
};

// ─── PATIENT CARD ──────────────────────────────────────────────────────────
const PatientCard = ({ patient, onClick }) => {
  const rc = getRiskCfg(patient.risk);
  const sc = getStatusCfg(patient.status);
  const doctor = getProf(patient.doctor);
  const psych  = getProf(patient.psychologist);
  return (
    <div onClick={() => onClick(patient)}
      className={`bg-[#131920] border ${rc.border} rounded-xl p-4 cursor-pointer hover:bg-[#1a2332] transition-all hover:shadow-lg hover:shadow-black/30 group relative overflow-hidden`}>
      <div className={`absolute inset-0 opacity-5 ${rc.bg}`}></div>
      <div className="relative">
        <div className="flex items-start justify-between mb-2.5">
          <div>
            <div className="text-[10px] text-slate-500 font-mono">{patient.id}</div>
            <div className="text-white font-bold text-base leading-tight">{patient.initials}</div>
            <div className="text-slate-400 text-xs">{patient.age} años · {patient.gender === "F" ? "F" : "M"}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <RiskBadge risk={patient.risk} />
            <StatusBadge status={patient.status} />
          </div>
        </div>
        <div className="text-xs text-slate-300 font-medium mb-2 leading-snug">{patient.dx_main}</div>
        <div className="flex items-center gap-2 mb-3">
          {patient.alerts > 0 && (
            <span className="flex items-center gap-1 text-red-400 text-[10px] font-semibold bg-red-900/20 px-1.5 py-0.5 rounded border border-red-800">
              <span>⚠</span>{patient.alerts} alerta{patient.alerts>1?"s":""}
            </span>
          )}
          {patient.tasks > 0 && (
            <span className="flex items-center gap-1 text-yellow-400 text-[10px] font-semibold bg-yellow-900/20 px-1.5 py-0.5 rounded border border-yellow-800">
              ✓ {patient.tasks} tarea{patient.tasks>1?"s":""}
            </span>
          )}
        </div>
        <div className="border-t border-slate-700/60 pt-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {[patient.doctor, patient.psychologist, patient.ot, patient.nurse, patient.social].filter(Boolean).slice(0,4).map((pid,i) => (
              <ProfAvatar key={i} id={pid} />
            ))}
          </div>
          <div className="text-[10px] text-slate-500">
            {patient.next_control ? <>⏱ {patient.next_control}</> : <span className="text-orange-400">Sin próximo control</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── PATIENT DETAIL ────────────────────────────────────────────────────────
const PatientDetail = ({ patient, onClose, onEdit }) => {
  const [tab, setTab] = useState("resumen");
  const rc = getRiskCfg(patient.risk);
  const patAlerts = ALERTS.filter(a => a.patient === patient.id);
  const patMeds   = patient.meds.map(mid => MEDICATIONS.find(m => m.id === mid)).filter(Boolean);
  const patTrace  = TRACE_EVENTS.filter(t => t.patient === patient.id);
  const patMsgs   = MESSAGES.filter(m => m.patient === patient.id);
  const patFiles  = FILES.filter(f => f.patient === patient.id);

  const TABS = [
    { id:"resumen",     label:"Resumen" },
    { id:"dx",          label:"Diagnósticos" },
    { id:"farmacos",    label:"Fármacos" },
    { id:"alertas",     label:"Alertas" },
    { id:"equipo",      label:"Equipo" },
    { id:"archivos",    label:"Archivos" },
    { id:"historial",   label:"Historial" },
    { id:"mensajes",    label:"Mensajes" },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-end" onClick={onClose}>
      <div className="w-full max-w-2xl h-screen bg-[#0d1117] overflow-y-auto flex flex-col border-l border-slate-700 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`border-b ${rc.border} border-opacity-50 p-5 bg-[#131920]`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[10px] text-slate-500 font-mono">{patient.id}</div>
              <div className="text-white text-xl font-bold">{patient.initials}</div>
              <div className="text-slate-400 text-sm">{patient.age} años · {patient.gender === "F" ? "Femenino" : "Masculino"}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {onEdit && (
                  <button
                    onClick={() => onEdit(patient)}
                    className="rounded-full border border-sky-700 bg-sky-900/30 px-3 py-1 text-xs font-black text-sky-300 hover:bg-sky-800/50"
                  >
                    Editar
                  </button>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              <RiskBadge risk={patient.risk} />
              <StatusBadge status={patient.status} />
            </div>
          </div>
          <div className="text-sm text-slate-200 font-medium mb-2">{patient.dx_main}</div>
          <Disclaimer />
        </div>
        {/* Tabs */}
        <div className="border-b border-slate-800 flex overflow-x-auto bg-[#0d1117] px-4 gap-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                ${tab === t.id ? "border-sky-400 text-sky-400" : "border-transparent text-slate-500 hover:text-slate-300"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {/* Tab content */}
        <div className="flex-1 p-5 space-y-4">
          {tab === "resumen" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Riesgo suicida", patient.suicide_risk, "riesgo"],
                  ["Riesgo heteroagresivo", patient.hetero_risk, "riesgo"],
                  ["Riesgo social", patient.social_risk, "riesgo"],
                  ["Consumo sustancias", patient.substances, "info"],
                  ["Adherencia estimada", patient.adherence, "info"],
                  ["Estado funcional", patient.functional, "info"],
                  ["Red de apoyo", patient.support, "info"],
                  ["Ingreso al programa", patient.admission, "date"],
                ].map(([label, value, type]) => (
                  <div key={label} className="bg-[#131920] rounded-lg p-3 border border-slate-800">
                    <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-1">{label}</div>
                    <div className={`text-sm font-medium ${type === "riesgo" && value === "alto" ? "text-orange-400" : type === "riesgo" && value === "critico" ? "text-red-400" : type === "riesgo" && value === "medio" ? "text-yellow-400" : "text-slate-200"}`}>
                      {value || "—"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-[#131920] rounded-lg p-3 border border-slate-800">
                <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Observaciones de gestión</div>
                <p className="text-sm text-slate-300 leading-relaxed">{patient.notes}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#131920] rounded-lg p-3 border border-slate-800 text-center">
                  <div className="text-slate-500 text-[10px] mb-1">Último contacto</div>
                  <div className="text-sky-400 text-xs font-mono">{patient.last_contact}</div>
                </div>
                <div className="bg-[#131920] rounded-lg p-3 border border-slate-800 text-center">
                  <div className="text-slate-500 text-[10px] mb-1">Próximo control</div>
                  <div className={`text-xs font-mono ${patient.next_control ? "text-emerald-400" : "text-red-400"}`}>
                    {patient.next_control || "Sin agendar"}
                  </div>
                </div>
                <div className="bg-[#131920] rounded-lg p-3 border border-slate-800 text-center">
                  <div className="text-slate-500 text-[10px] mb-1">Alertas activas</div>
                  <div className={`text-xs font-bold ${patient.alerts > 0 ? "text-red-400" : "text-emerald-400"}`}>{patient.alerts}</div>
                </div>
              </div>
            </>
          )}
          {tab === "dx" && (
            <div className="space-y-3">
              <div className="bg-[#131920] rounded-lg p-4 border border-sky-800">
                <div className="text-[10px] text-sky-400 uppercase font-semibold tracking-wider mb-2">Diagnóstico principal de trabajo</div>
                <div className="text-slate-100 font-medium">{patient.dx_main}</div>
              </div>
              {patient.dx_secondary?.length > 0 && (
                <div className="bg-[#131920] rounded-lg p-4 border border-slate-700">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider mb-2">Diagnósticos secundarios</div>
                  <ul className="space-y-1.5">
                    {patient.dx_secondary.map((d, i) => (
                      <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                        <span className="text-slate-600 mt-0.5">◦</span>{d}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="text-xs text-amber-500/70 bg-amber-900/10 border border-amber-800/30 rounded p-3">
                ⚠ Los diagnósticos de trabajo son orientativos para coordinación. No constituyen diagnóstico clínico definitivo.
              </div>
            </div>
          )}
          {tab === "farmacos" && (
            <div className="space-y-3">
              {patMeds.length === 0 && <div className="text-slate-500 text-sm">Sin tratamientos registrados.</div>}
              {patMeds.map(med => (
                <div key={med.id} className="bg-[#131920] rounded-lg p-4 border border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-white font-semibold">{med.drug} <span className="text-sky-400">{med.dose}</span></div>
                    <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">{med.scheme}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <span>Freq: <span className="text-slate-200">{med.freq}</span></span>
                    <span>Inicio: <span className="text-slate-200">{med.startDate}</span></span>
                    <span>Último ajuste: <span className="text-slate-200">{med.lastAdj}</span></span>
                    <span>Prox. control: <span className="text-yellow-400">{med.nextControl}</span></span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-700 pt-2">
                    <div className="text-[10px] text-slate-400 italic">{med.followup}</div>
                    <ProfAvatar id={med.prescriber} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === "alertas" && (
            <div className="space-y-2">
              {patAlerts.length === 0 && <div className="text-slate-500 text-sm">Sin alertas activas.</div>}
              {patAlerts.map(a => {
                const rc2 = getRiskCfg(a.priority);
                return (
                  <div key={a.id} className={`bg-[#131920] rounded-lg p-3 border ${rc2.border} border-opacity-60 flex gap-3`}>
                    <div className={`w-1 rounded-full flex-shrink-0 ${rc2.dot}`}></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-100">{a.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          a.status==="pendiente" ? "border-red-700 text-red-400" :
                          a.status==="en_curso" ? "border-yellow-700 text-yellow-400" :
                          "border-emerald-700 text-emerald-400"}`}>{a.status}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{a.comment}</div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-slate-500">⏱ {a.due}</span>
                        <ProfAvatar id={a.responsible} size="sm" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tab === "equipo" && (
            <div className="space-y-2">
              {[
                ["Médico psiquiatra", patient.doctor],
                ["Psicólogo/a", patient.psychologist],
                ["Terapeuta Ocupacional", patient.ot],
                ["Enfermería", patient.nurse],
                ["Trabajo Social", patient.social],
              ].map(([role, pid]) => {
                const prof = getProf(pid);
                return (
                  <div key={role} className="bg-[#131920] rounded-lg p-3 border border-slate-700 flex items-center justify-between">
                    <span className="text-xs text-slate-400">{role}</span>
                    {prof ? (
                      <div className="flex items-center gap-2">
                        <ProfAvatar id={pid} />
                        <span className="text-sm text-slate-200 font-medium">{prof.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-orange-400 bg-orange-900/20 border border-orange-800 px-2 py-0.5 rounded">Sin asignar</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {tab === "archivos" && (
            <div className="space-y-2">
              {patFiles.length === 0 && <div className="text-slate-500 text-sm">Sin archivos adjuntos.</div>}
              {patFiles.map(f => (
                <div key={f.id} className="bg-[#131920] rounded-lg p-3 border border-slate-700 flex items-center gap-3">
                  <div className="w-8 h-8 bg-red-900/40 border border-red-700 rounded flex items-center justify-center text-red-400 text-xs font-bold">PDF</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 font-medium truncate">{f.name}</div>
                    <div className="text-[10px] text-slate-500">{f.size} · {f.date} · {getProf(f.author)?.name}</div>
                  </div>
                </div>
              ))}
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-4 text-center text-slate-500 text-xs hover:border-sky-700 cursor-pointer transition-colors">
                + Adjuntar archivo (máx. 5 MB · PDF, JPG, PNG)
              </div>
            </div>
          )}
          {tab === "historial" && (
            <div className="space-y-2">
              {patTrace.length === 0 && <div className="text-slate-500 text-sm">Sin eventos registrados.</div>}
              {patTrace.map(ev => {
                const prof = getProf(ev.user);
                return (
                  <div key={ev.id} className="bg-[#131920] rounded-lg p-3 border border-slate-700 flex gap-3">
                    <ProfAvatar id={ev.user} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">{ev.action}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{ev.ts}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">{prof?.name} · {prof && ROLE_LABELS[prof.role]}</div>
                      {ev.field !== "-" && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          <span className="text-slate-400">{ev.field}:</span> {ev.prev} → <span className="text-sky-400">{ev.next}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tab === "mensajes" && (
            <div className="space-y-2">
              {patMsgs.length === 0 && <div className="text-slate-500 text-sm">Sin mensajes asociados a este caso.</div>}
              {patMsgs.map(msg => {
                const from = getProf(msg.from);
                const to   = getProf(msg.to);
                return (
                  <div key={msg.id} className={`bg-[#131920] rounded-lg p-3 border ${msg.important ? "border-yellow-700" : "border-slate-700"} flex gap-3`}>
                    <ProfAvatar id={msg.from} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-semibold text-slate-200">{from?.initials} → {to?.initials}</span>
                        <span className="text-[10px] text-slate-500">{msg.ts}</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">{msg.text}</p>
                      {msg.important && <span className="text-[10px] text-yellow-400">★ Importante</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────
const Dashboard = ({ setPage }) => {
  const activos      = PATIENTS.filter(p => p.status === "activo").length;
  const criticos     = PATIENTS.filter(p => p.risk === "critico").length;
  const inasistentes = PATIENTS.filter(p => p.status === "inasistente").length;
  const hospitalizados = PATIENTS.filter(p => p.status === "hospitalizado").length;
  const alertasCrit  = ALERTS.filter(a => a.priority === "critico" && a.status !== "resuelto").length;
  const sinControl   = PATIENTS.filter(p => !p.next_control && p.status === "activo").length;

  const KPI_CARDS = [
    { label:"Pacientes activos",    value:activos,      sub:`de ${PATIENTS.length} totales`,   color:"text-sky-400",     accent:"border-sky-800" },
    { label:"Nivel crítico",        value:criticos,     sub:"requieren atención urgente",       color:"text-red-400",     accent:"border-red-800" },
    { label:"Inasistentes",         value:inasistentes, sub:"sin contacto reciente",            color:"text-yellow-400",  accent:"border-yellow-800" },
    { label:"Hospitalizados",       value:hospitalizados,sub:"en régimen cerrado",              color:"text-orange-400",  accent:"border-orange-800" },
    { label:"Alertas críticas",     value:alertasCrit,  sub:"pendientes de resolución",        color:"text-red-400",     accent:"border-red-800" },
    { label:"Sin próximo control",  value:sinControl,   sub:"pacientes activos sin cita",      color:"text-amber-400",   accent:"border-amber-800" },
  ];

  const riskDist = Object.entries(
    PATIENTS.reduce((acc, p) => { acc[p.risk] = (acc[p.risk]||0)+1; return acc; }, {})
  );

  const recentAlerts = ALERTS.filter(a => a.status !== "resuelto" && (a.priority === "critico" || a.priority === "alto")).slice(0,5);
  const recentTrace  = TRACE_EVENTS.slice(0,5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {KPI_CARDS.map((k,i) => (
          <div key={i} className={`bg-[#131920] rounded-xl p-4 border ${k.accent}`}>
            <div className={`text-3xl font-black ${k.color}`}>{k.value}</div>
            <div className="text-slate-200 text-sm font-semibold mt-1">{k.label}</div>
            <div className="text-slate-500 text-xs mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Distribución de riesgo */}
        <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
          <div className="text-slate-300 font-semibold text-sm mb-4">Distribución por nivel de riesgo</div>
          <div className="space-y-3">
            {riskDist.map(([risk, count]) => {
              const cfg = getRiskCfg(risk);
              const pct = Math.round((count / PATIENTS.length) * 100);
              return (
                <div key={risk}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                    <span className="text-xs text-slate-400">{count} pac · {pct}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${cfg.dot} rounded-full transition-all`} style={{ width:`${pct}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alertas urgentes */}
        <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
          <div className="text-slate-300 font-semibold text-sm mb-4 flex items-center justify-between">
            Alertas urgentes abiertas
            <button onClick={()=>setPage("alertas")} className="text-xs text-sky-400 hover:text-sky-300">Ver todas →</button>
          </div>
          <div className="space-y-2">
            {recentAlerts.map(a => {
              const rc2 = getRiskCfg(a.priority);
              return (
                <div key={a.id} className={`flex items-start gap-2 p-2 rounded-lg border ${rc2.border} border-opacity-40 bg-slate-900/40`}>
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${rc2.dot}`}></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-200 truncate">{a.title}</div>
                    <div className="text-[10px] text-slate-500">{a.patient} · ⏱ {a.due}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Trazabilidad reciente */}
      <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
        <div className="text-slate-300 font-semibold text-sm mb-4 flex items-center justify-between">
          Actividad reciente
          <button onClick={()=>setPage("trazabilidad")} className="text-xs text-sky-400 hover:text-sky-300">Ver registro completo →</button>
        </div>
        <div className="space-y-2">
          {recentTrace.map(ev => {
            const prof = getProf(ev.user);
            return (
              <div key={ev.id} className="flex items-center gap-3 py-1.5 border-b border-slate-800 last:border-0">
                <ProfAvatar id={ev.user} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-slate-200 font-medium">{ev.action}</span>
                  <span className="text-xs text-slate-500"> · {ev.patient}</span>
                  {ev.field !== "-" && <span className="text-xs text-slate-500"> · {ev.field}</span>}
                </div>
                <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{ev.ts.split(" ")[0]}</span>
              </div>
            );
          })}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
};

// ─── PACIENTES ────────────────────────────────────────────────────────────
const PacientesView = ({ search, workspaceKey, authSession, authProfile, onDataChanged, activeInstitution }) => {
  const [selected, setSelected] = useState(null);
  const [riskFilter, setRiskFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [formMode, setFormMode] = useState(null);
  const [editingPatient, setEditingPatient] = useState(null);
  const isAdmin = (getMembershipForWorkspace(ACTIVE_INSTITUTION_ID)?.role === "admin" || ACTIVE_USER_ID === "admin");

  const openCreate = () => { setEditingPatient(null); setFormMode("create"); };
  const openEdit = (patient) => { setSelected(null); setEditingPatient(patient); setFormMode("edit"); };
  const closeForm = () => { setFormMode(null); setEditingPatient(null); };

  const filtered = useMemo(() => PATIENTS.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = !q || p.initials.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.dx_main.toLowerCase().includes(q);
    const matchRisk   = riskFilter === "all" || p.risk === riskFilter;
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchRisk && matchStatus;
  }), [search, riskFilter, statusFilter, workspaceKey]);

  return (
    <div>
      {selected && <PatientDetail patient={selected} onClose={() => setSelected(null)} onEdit={openEdit} />}
      {formMode && (
        <PatientFormModal
          mode={formMode}
          patient={editingPatient}
          authSession={authSession}
          authProfile={authProfile}
          activeInstitution={activeInstitution || workspaceKey}
          onClose={closeForm}
          onSaved={onDataChanged}
        />
      )}
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Riesgo:</span>
          {["all","critico","alto","medio","bajo","no_evaluado"].map(r => (
            <button key={r} onClick={() => setRiskFilter(r)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
                ${riskFilter === r
                  ? (r==="all" ? "bg-slate-600 border-slate-500 text-white" : `${getRiskCfg(r).bg} ${getRiskCfg(r).border} ${getRiskCfg(r).text}`)
                  : "bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200"}`}>
              {r === "all" ? "Todos" : getRiskCfg(r).label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {USING_SUPABASE_DATA && (
            <button
              onClick={openCreate}
              disabled={!isAdmin}
              title={isAdmin ? "Crear paciente en Supabase" : "Solo administrador puede crear pacientes en esta versión"}
              className="rounded-full border border-sky-600 bg-sky-600/20 px-3 py-1 text-xs font-black text-sky-300 hover:bg-sky-600/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Nuevo paciente
            </button>
          )}
          <button onClick={() => setViewMode("grid")} className={`px-2 py-1 text-xs rounded border ${viewMode==="grid" ? "bg-sky-600/20 border-sky-600 text-sky-400" : "border-slate-700 text-slate-500"}`}>▦ Tarjetas</button>
          <button onClick={() => setViewMode("table")} className={`px-2 py-1 text-xs rounded border ${viewMode==="table" ? "bg-sky-600/20 border-sky-600 text-sky-400" : "border-slate-700 text-slate-500"}`}>≡ Tabla</button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-500">{filtered.length} paciente{filtered.length!==1?"s":""}</div>
        {USING_SUPABASE_DATA && (
          <div className="text-[10px] text-slate-500">
            {isAdmin ? "Puedes crear, editar y reasignar equipo." : "Puedes editar pacientes asignados. La reasignación de equipo queda para admin."}
          </div>
        )}
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => <PatientCard key={p.id} patient={p} onClick={setSelected} />)}
        </div>
      ) : (
        <div className="bg-[#131920] rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
                {["ID","Paciente","Edad","Diagnóstico","Riesgo","Estado","Próx. control","Responsable"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.id} onClick={() => setSelected(p)}
                  className={`border-b border-slate-800/50 hover:bg-[#1a2332] cursor-pointer transition-colors ${i%2===0?"":"bg-slate-900/20"}`}>
                  <td className="px-4 py-3 font-mono text-slate-500">{p.id}</td>
                  <td className="px-4 py-3 text-slate-200 font-semibold">{p.initials}</td>
                  <td className="px-4 py-3 text-slate-400">{p.age}</td>
                  <td className="px-4 py-3 text-slate-300 max-w-[200px] truncate">{p.dx_main}</td>
                  <td className="px-4 py-3"><RiskBadge risk={p.risk} small /></td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3 font-mono text-slate-400">{p.next_control || <span className="text-red-400">—</span>}</td>
                  <td className="px-4 py-3"><ProfAvatar id={p.doctor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ─── PROFESIONALES ────────────────────────────────────────────────────────
const ProfesionalesView = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 gap-4">
      {PROFESSIONALS.map(prof => {
        const assigned  = PATIENTS.filter(p => [p.doctor,p.psychologist,p.ot,p.nurse,p.social].includes(prof.id));
        const critPats  = assigned.filter(p => p.risk === "critico" || p.risk === "alto").length;
        const openAlerts= ALERTS.filter(a => a.responsible === prof.id && a.status !== "resuelto").length;
        return (
          <div key={prof.id} className="bg-[#131920] rounded-xl p-4 border border-slate-700 hover:border-slate-600 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 ${prof.color} rounded-xl flex items-center justify-center text-white font-bold`}>{prof.initials}</div>
              <div>
                <div className="text-slate-100 font-semibold text-sm">{prof.name}</div>
                <div className="text-slate-400 text-xs">{prof.specialty}</div>
                <div className="text-slate-500 text-[10px]">{ROLE_LABELS[prof.role]}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Pacientes", assigned.length, "text-sky-400"],
                ["Riesgo alto/crit.", critPats, "text-orange-400"],
                ["Alertas abiertas", openAlerts, openAlerts > 0 ? "text-red-400" : "text-emerald-400"],
              ].map(([lbl, val, clr]) => (
                <div key={lbl} className="bg-slate-900/40 rounded-lg p-2 text-center">
                  <div className={`text-lg font-black ${clr}`}>{val}</div>
                  <div className="text-[10px] text-slate-500">{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
    {/* Tabla asignaciones */}
    <div className="bg-[#131920] rounded-xl border border-slate-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-slate-300">Asignación por paciente</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
            {["Paciente","Riesgo","Psiquiatra","Psicólogo/a","T.O.","Enfermería","T. Social"].map(h=>(
              <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PATIENTS.filter(p=>p.status!=="alta").map((p,i)=>(
            <tr key={p.id} className={`border-b border-slate-800/40 ${i%2===0?"":"bg-slate-900/20"}`}>
              <td className="px-3 py-2 text-slate-200 font-semibold">{p.initials}</td>
              <td className="px-3 py-2"><RiskBadge risk={p.risk} small /></td>
              {[p.doctor,p.psychologist,p.ot,p.nurse,p.social].map((pid,j)=>(
                <td key={j} className="px-3 py-2">
                  {pid
                    ? <div className="flex items-center gap-1"><ProfAvatar id={pid} size="sm" /><span className="text-slate-400 truncate max-w-[80px]">{getProf(pid)?.name.split(" ")[0]}</span></div>
                    : <span className="text-orange-400/60">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ─── ALERTAS ──────────────────────────────────────────────────────────────
const AlertasView = () => {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? ALERTS : ALERTS.filter(a => a.priority === filter || a.status === filter || a.type === filter);
  const pendientes = ALERTS.filter(a => a.status === "pendiente").length;
  const criticas   = ALERTS.filter(a => a.priority === "critico" && a.status !== "resuelto").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Pendientes", pendientes, "text-red-400 border-red-800"],
          ["En curso", ALERTS.filter(a=>a.status==="en_curso").length, "text-yellow-400 border-yellow-800"],
          ["Resueltas", ALERTS.filter(a=>a.status==="resuelto").length, "text-emerald-400 border-emerald-800"],
          ["Críticas abiertas", criticas, "text-red-400 border-red-700"],
        ].map(([l,v,c])=>(
          <div key={l} className={`bg-[#131920] rounded-xl p-4 border ${c.split(" ")[1]}`}>
            <div className={`text-2xl font-black ${c.split(" ")[0]}`}>{v}</div>
            <div className="text-slate-400 text-xs mt-1">{l}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {["all","critico","alto","medio","pendiente","en_curso","resuelto","farmaco","riesgo","control"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors
              ${filter===f ? "bg-sky-600/20 border-sky-600 text-sky-400" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
            {f==="all"?"Todas":f.replace("_"," ")}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(a => {
          const rc = getRiskCfg(a.priority);
          return (
            <div key={a.id} className={`bg-[#131920] rounded-xl p-4 border ${rc.border} border-opacity-50 flex gap-4`}>
              <div className={`w-1 rounded-full flex-shrink-0 ${rc.dot}`}></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{a.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{a.comment}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                      a.status==="pendiente" ? "border-red-700 text-red-400 bg-red-900/20" :
                      a.status==="en_curso"  ? "border-yellow-700 text-yellow-400 bg-yellow-900/20" :
                      "border-emerald-700 text-emerald-400 bg-emerald-900/20"}`}>{a.status.replace("_"," ")}</span>
                    <RiskBadge risk={a.priority} small />
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-[10px] text-slate-500">📋 {a.patient}</span>
                  <span className="text-[10px] text-slate-500">⏱ {a.due}</span>
                  <div className="flex items-center gap-1">
                    <ProfAvatar id={a.responsible} size="sm" />
                    <span className="text-[10px] text-slate-500">{getProf(a.responsible)?.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">{a.type}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


// ─── PROGRAMA CLOZAPINA ──────────────────────────────────────────────────
const ProgramaClozapinaView = ({ authSession, onDataChanged }) => {
  const [modalRow, setModalRow] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const rows = getClozapineRows();
  const exportRows = rows.map(r => ({
    paciente: r.paciente,
    iniciales: r.iniciales,
    riesgo: getRiskCfg(r.riesgo).label,
    estado: getStatusCfg(r.estado).label,
    farmaco: r.farmaco,
    dosis: r.dosis,
    esquema: r.esquema,
    periodicidad_hemograma: r.periodicidadHemograma,
    ultimo_hemograma: r.ultimoHemograma,
    proximo_hemograma: r.proximoHemograma,
    dias_para_proximo: r.dias,
    neutrofilos: r.neutrofilos,
    leucocitos: r.leucocitos,
    responsable: r.responsable,
    nota: r.nota,
  }));
  const openNew = () => { setModalRow(null); setModalOpen(true); };
  const openEdit = (row) => { setModalRow(row); setModalOpen(true); };
  return (
    <div className="space-y-5">
      {modalOpen && <ClinicalProgramModal type="clozapine" row={modalRow} authSession={authSession} onClose={() => setModalOpen(false)} onSaved={onDataChanged} />}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-red-800/50 bg-red-900/10 p-5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-red-400 font-black">Programa exclusivo</div>
          <div className="mt-1 text-xl font-black text-slate-100">Seguimiento de Clozapina</div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Control real en Supabase: dosis, esquema, periodicidad, último hemograma, próxima fecha, leucocitos, neutrófilos y responsable.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={openNew} className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-black text-white shadow-lg shadow-red-950/40 hover:bg-red-500">+ Ingresar / actualizar</button>
          <ExportButton rows={exportRows} filename={`programa_clozapina_${ACTIVE_INSTITUTION_ID}_${ACTIVE_USER_ID}`} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          ["Pacientes en clozapina", rows.length, "text-red-400"],
          ["Hemogramas vencidos", rows.filter(r=>r.dias < 0).length, "text-orange-400"],
          ["Próximos 7 días", rows.filter(r=>r.dias >= 0 && r.dias <= 7).length, "text-yellow-400"],
          ["Vigentes", rows.filter(r=>r.dias > 7).length, "text-emerald-400"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-[#131920] p-4">
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="mt-1 text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#131920] p-5 text-sm text-slate-500">No hay pacientes visibles en programa de clozapina para esta sesión. Usa “Ingresar / actualizar” para agregar uno.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#131920]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
                {["Paciente","Riesgo","Dosis","Esquema","Último hemograma","Próximo hemograma","Estado","RAN/GB","Responsable","Nota","Acción"].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={`${r.paciente}-${r.farmaco}`} className={`border-b border-slate-800/40 hover:bg-[#1a2332] ${i%2 ? "bg-slate-900/20" : ""}`}>
                  <td className="px-3 py-3 font-semibold text-slate-100"><div>{r.iniciales}</div><div className="text-[10px] font-mono text-slate-500">{r.paciente}</div></td>
                  <td className="px-3 py-3"><RiskBadge risk={r.riesgo} small /></td>
                  <td className="px-3 py-3 font-mono text-sky-400">{r.dosis}</td>
                  <td className="px-3 py-3 font-mono text-slate-400">{r.esquema}</td>
                  <td className="px-3 py-3 font-mono text-slate-300">{r.ultimoHemograma}</td>
                  <td className="px-3 py-3 font-mono text-yellow-400">{r.proximoHemograma}</td>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${r.status.tone}`}>{r.status.label}</span></td>
                  <td className="px-3 py-3 text-slate-300"><div>RAN {r.neutrofilos}</div><div className="text-[10px] text-slate-500">GB {r.leucocitos}</div></td>
                  <td className="px-3 py-3 text-slate-400">{r.responsable}</td>
                  <td className="px-3 py-3 max-w-[220px] text-slate-500">{r.nota}</td>
                  <td className="px-3 py-3"><button onClick={() => openEdit(r)} className="rounded-lg border border-sky-700 px-2 py-1 text-[10px] font-bold text-sky-400 hover:bg-sky-950/40">Actualizar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Disclaimer />
    </div>
  );
};

// ─── PROGRAMA INYECTABLES DE DEPÓSITO ────────────────────────────────────
const ProgramaInyectablesView = ({ authSession, onDataChanged }) => {
  const [modalRow, setModalRow] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const rows = getDepotRows();
  const exportRows = rows.map(r => ({
    paciente: r.paciente,
    iniciales: r.iniciales,
    riesgo: getRiskCfg(r.riesgo).label,
    estado: getStatusCfg(r.estado).label,
    farmaco: r.farmaco,
    dosis: r.dosis,
    esquema: r.esquema,
    periodicidad: r.periodicidad,
    ultima_administracion: r.ultimaAdministracion,
    proxima_administracion: r.proximaAdministracion,
    dias_para_proxima: r.dias,
    sitio: r.sitio,
    responsable: r.responsable,
    nota: r.nota,
  }));
  const openNew = () => { setModalRow(null); setModalOpen(true); };
  const openEdit = (row) => { setModalRow(row); setModalOpen(true); };
  return (
    <div className="space-y-5">
      {modalOpen && <ClinicalProgramModal type="lai" row={modalRow} authSession={authSession} onClose={() => setModalOpen(false)} onSaved={onDataChanged} />}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-violet-800/50 bg-violet-900/10 p-5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-violet-400 font-black">Programa exclusivo</div>
          <div className="mt-1 text-xl font-black text-slate-100">Inyectables de depósito</div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Seguimiento real de LAI/depot: dosis, periodicidad, última administración, próxima fecha, sitio, responsable y trazabilidad.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={openNew} className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-black text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500">+ Registrar LAI</button>
          <ExportButton rows={exportRows} filename={`programa_inyectables_${ACTIVE_INSTITUTION_ID}_${ACTIVE_USER_ID}`} />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          ["Pacientes con LAI", rows.length, "text-violet-400"],
          ["Administraciones vencidas", rows.filter(r=>r.dias < 0).length, "text-red-400"],
          ["Próximos 7 días", rows.filter(r=>r.dias >= 0 && r.dias <= 7).length, "text-yellow-400"],
          ["Vigentes", rows.filter(r=>r.dias > 7).length, "text-emerald-400"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-[#131920] p-4">
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="mt-1 text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-[#131920] p-5 text-sm text-slate-500">No hay pacientes visibles con inyectables de depósito para esta sesión. Usa “Registrar LAI” para agregar uno.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#131920]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
                {["Paciente","Riesgo","Fármaco","Dosis","Periodicidad","Última adm.","Próxima adm.","Estado","Sitio","Responsable","Nota","Acción"].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={`${r.paciente}-${r.farmaco}`} className={`border-b border-slate-800/40 hover:bg-[#1a2332] ${i%2 ? "bg-slate-900/20" : ""}`}>
                  <td className="px-3 py-3 font-semibold text-slate-100"><div>{r.iniciales}</div><div className="text-[10px] font-mono text-slate-500">{r.paciente}</div></td>
                  <td className="px-3 py-3"><RiskBadge risk={r.riesgo} small /></td>
                  <td className="px-3 py-3 text-slate-100 font-semibold">{r.farmaco}</td>
                  <td className="px-3 py-3 font-mono text-sky-400">{r.dosis}</td>
                  <td className="px-3 py-3 text-slate-300">{r.periodicidad}</td>
                  <td className="px-3 py-3 font-mono text-slate-300">{r.ultimaAdministracion}</td>
                  <td className="px-3 py-3 font-mono text-yellow-400">{r.proximaAdministracion}</td>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${r.status.tone}`}>{r.status.label}</span></td>
                  <td className="px-3 py-3 text-slate-400">{r.sitio}</td>
                  <td className="px-3 py-3 text-slate-400">{r.responsable}</td>
                  <td className="px-3 py-3 max-w-[220px] text-slate-500">{r.nota}</td>
                  <td className="px-3 py-3"><button onClick={() => openEdit(r)} className="rounded-lg border border-sky-700 px-2 py-1 text-[10px] font-bold text-sky-400 hover:bg-sky-950/40">Actualizar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Disclaimer />
    </div>
  );
};

// ─── FARMACOTERAPIA ───────────────────────────────────────────────────────
const FarmacoterapiaView = () => {
  const exportRows = MEDICATIONS.map(m => ({
    farmaco: m.drug,
    dosis: m.dose,
    esquema: m.scheme,
    frecuencia: m.freq,
    inicio: m.startDate,
    ultimo_ajuste: m.lastAdj,
    proximo_control: m.nextControl,
    seguimiento: m.followup,
    indicado_por: getProf(m.prescriber)?.name || m.prescriber,
  }));
  return (
  <div className="space-y-5">
    <div className="flex justify-end"><ExportButton rows={exportRows} filename={`farmacoterapia_${ACTIVE_INSTITUTION_ID}_${ACTIVE_USER_ID}`} /></div>
    <div className="grid grid-cols-3 gap-3">
      {[
        ["Fármacos registrados", MEDICATIONS.length, "text-sky-400"],
        ["Controles pendientes", ALERTS.filter(a=>a.type==="farmaco"&&a.status!=="resuelto").length, "text-orange-400"],
        ["Alertas farmacológicas", ALERTS.filter(a=>a.type==="farmaco").length, "text-red-400"],
      ].map(([l,v,c])=>(
        <div key={l} className="bg-[#131920] rounded-xl p-4 border border-slate-800">
          <div className={`text-2xl font-black ${c}`}>{v}</div>
          <div className="text-slate-400 text-xs mt-1">{l}</div>
        </div>
      ))}
    </div>

    <div className="bg-[#131920] rounded-xl border border-slate-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-slate-300">Tratamientos activos registrados</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
            {["Fármaco","Dosis","Esquema","Frecuencia","Inicio","Último ajuste","Prox. control","Seguimiento","Indicado por"].map(h=>(
              <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MEDICATIONS.map((m,i)=>(
            <tr key={m.id} className={`border-b border-slate-800/40 hover:bg-[#1a2332] transition-colors ${i%2===0?"":"bg-slate-900/20"}`}>
              <td className="px-3 py-2.5 text-slate-100 font-semibold">{m.drug}</td>
              <td className="px-3 py-2.5 text-sky-400 font-mono">{m.dose}</td>
              <td className="px-3 py-2.5 font-mono text-slate-400 bg-slate-800/40 text-center rounded">{m.scheme}</td>
              <td className="px-3 py-2.5 text-slate-300">{m.freq}</td>
              <td className="px-3 py-2.5 text-slate-500 font-mono">{m.startDate}</td>
              <td className="px-3 py-2.5 text-slate-500 font-mono">{m.lastAdj}</td>
              <td className="px-3 py-2.5 text-yellow-400 font-mono">{m.nextControl}</td>
              <td className="px-3 py-2.5 text-slate-400 italic max-w-[160px]">
                <span className={m.followup.includes("⚠") ? "text-orange-400" : ""}>{m.followup}</span>
              </td>
              <td className="px-3 py-2.5"><ProfAvatar id={m.prescriber} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="bg-amber-900/10 border border-amber-700/30 rounded-xl p-4">
      <div className="text-amber-400 text-xs font-semibold mb-2">⚠ Alertas farmacológicas activas</div>
      <div className="grid grid-cols-2 gap-2">
        {ALERTS.filter(a=>a.type==="farmaco"&&a.status!=="resuelto").map(a=>(
          <div key={a.id} className="text-xs text-amber-300/70 flex items-start gap-2">
            <span className="text-amber-500 flex-shrink-0">◦</span>
            <span><strong>{a.patient}</strong>: {a.title}</span>
          </div>
        ))}
      </div>
    </div>
    <Disclaimer />
  </div>
  );
};

// ─── TRAZABILIDAD ─────────────────────────────────────────────────────────
const TrazabilidadView = () => {
  const [typeFilter, setTypeFilter] = useState("all");
  const filtered = typeFilter === "all" ? TRACE_EVENTS : TRACE_EVENTS.filter(e=>e.type===typeFilter);
  const typeColors = {
    edicion:"text-sky-400 bg-sky-900/20 border-sky-800",
    alerta:"text-red-400 bg-red-900/20 border-red-800",
    tarea:"text-emerald-400 bg-emerald-900/20 border-emerald-800",
    creacion:"text-violet-400 bg-violet-900/20 border-violet-800",
    archivo:"text-amber-400 bg-amber-900/20 border-amber-800",
    mensaje:"text-slate-400 bg-slate-800/40 border-slate-700",
  };
  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {["all","edicion","alerta","tarea","creacion","archivo","mensaje"].map(t=>(
          <button key={t} onClick={()=>setTypeFilter(t)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors
              ${typeFilter===t ? "bg-sky-600/20 border-sky-600 text-sky-400" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
            {t==="all"?"Todos":t}
          </button>
        ))}
      </div>
      <div className="bg-[#131920] rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider">
              {["Fecha/Hora","Usuario","Rol","Acción","Paciente","Campo","Anterior","Nuevo","Tipo"].map(h=>(
                <th key={h} className="px-3 py-2.5 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((ev,i)=>{
              const prof = getProf(ev.user);
              const tc = typeColors[ev.type] || "text-slate-400 bg-slate-800/20 border-slate-700";
              return (
                <tr key={ev.id} className={`border-b border-slate-800/40 hover:bg-[#1a2332] transition-colors ${i%2===0?"":"bg-slate-900/20"}`}>
                  <td className="px-3 py-2.5 font-mono text-slate-500 whitespace-nowrap">{ev.ts}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <ProfAvatar id={ev.user} size="sm" />
                      <span className="text-slate-300">{prof?.initials}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{prof && ROLE_LABELS[prof.role]}</td>
                  <td className="px-3 py-2.5 text-slate-200 font-medium">{ev.action}</td>
                  <td className="px-3 py-2.5 text-slate-400">{ev.patient}</td>
                  <td className="px-3 py-2.5 text-slate-400">{ev.field !== "-" ? ev.field : "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{ev.prev !== "-" ? ev.prev : "—"}</td>
                  <td className="px-3 py-2.5 text-sky-400">{ev.next !== "-" ? ev.next : "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${tc}`}>{ev.type}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-slate-500 bg-slate-900/50 border border-slate-800 rounded p-3">
        🔒 El registro de trazabilidad es de solo lectura. Cada acción queda registrada de forma inmutable para auditoría clínica-operativa.
      </div>
    </div>
  );
};

// ─── ESTADÍSTICAS ─────────────────────────────────────────────────────────
const EstadisticasView = () => {
  const byRisk    = Object.entries(PATIENTS.reduce((a,p)=>{a[p.risk]=(a[p.risk]||0)+1;return a;},{}));
  const byStatus  = Object.entries(PATIENTS.reduce((a,p)=>{a[p.status]=(a[p.status]||0)+1;return a;},{}));
  const byDoctor  = PROFESSIONALS.filter(p=>p.role==="psiquiatra"||p.role==="psiquiatra_jefe"||p.role==="medico_general").map(p=>({
    name:p.initials, count:PATIENTS.filter(pt=>pt.doctor===p.id).length
  }));
  const maxBar = Math.max(...byDoctor.map(d=>d.count), 1);
  const exportRows = [
    { categoria:"total_pacientes", valor:PATIENTS.length },
    { categoria:"activos", valor:PATIENTS.filter(p=>p.status==="activo").length },
    { categoria:"farmacos_monitoreados", valor:MEDICATIONS.length },
    { categoria:"alertas_abiertas", valor:ALERTS.filter(a=>a.status!=="resuelto").length },
    ...byRisk.map(([risk,cnt]) => ({ categoria:`riesgo_${risk}`, valor:cnt })),
    ...byStatus.map(([status,cnt]) => ({ categoria:`estado_${status}`, valor:cnt })),
    ...byDoctor.map(d => ({ categoria:`medico_${d.name}`, valor:d.count })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#131920] p-4">
        <div>
          <div className="text-sm font-bold text-slate-100">Exportación de estadísticas</div>
          <div className="text-xs text-slate-500">Descarga los indicadores visibles según institución y usuario activo.</div>
        </div>
        <ExportButton rows={exportRows} filename={`estadisticas_${ACTIVE_INSTITUTION_ID}_${ACTIVE_USER_ID}`} />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[
          ["Total pacientes", PATIENTS.length, "text-white"],
          ["Activos", PATIENTS.filter(p=>p.status==="activo").length, "text-emerald-400"],
          ["Fármacos monitoreados", MEDICATIONS.length, "text-sky-400"],
          ["Alertas abiertas", ALERTS.filter(a=>a.status!=="resuelto").length, "text-red-400"],
        ].map(([l,v,c])=>(
          <div key={l} className="bg-[#131920] rounded-xl p-4 border border-slate-800">
            <div className={`text-3xl font-black ${c}`}>{v}</div>
            <div className="text-slate-400 text-xs mt-1">{l}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Riesgo */}
        <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
          <div className="text-slate-300 font-semibold text-sm mb-4">Por nivel de riesgo</div>
          <div className="space-y-3">
            {byRisk.map(([risk,cnt])=>{
              const cfg = getRiskCfg(risk);
              const pct = Math.round((cnt/PATIENTS.length)*100);
              return (
                <div key={risk}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className={cfg.text}>{cfg.label}</span>
                    <span className="text-slate-500">{cnt} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full">
                    <div className={`h-full ${cfg.dot} rounded-full`} style={{width:`${pct}%`}}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Estado */}
        <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
          <div className="text-slate-300 font-semibold text-sm mb-4">Por estado clínico</div>
          <div className="space-y-3">
            {byStatus.map(([status,cnt])=>{
              const cfg = getStatusCfg(status);
              const pct = Math.round((cnt/PATIENTS.length)*100);
              return (
                <div key={status}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{cfg.label}</span>
                    <span className="text-slate-500">{cnt}</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full">
                    <div className="h-full bg-sky-600 rounded-full" style={{width:`${pct}%`}}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Carga médica */}
        <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
          <div className="text-slate-300 font-semibold text-sm mb-4">Carga por médico responsable</div>
          <div className="space-y-3">
            {byDoctor.filter(d=>d.count>0).map(d=>{
              const pct = Math.round((d.count/maxBar)*100);
              return (
                <div key={d.name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{d.name}</span>
                    <span className="text-slate-500">{d.count} pac.</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full">
                    <div className="h-full bg-violet-600 rounded-full" style={{width:`${pct}%`}}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Alertas por tipo */}
      <div className="bg-[#131920] rounded-xl p-5 border border-slate-800">
        <div className="text-slate-300 font-semibold text-sm mb-4">Alertas por tipo</div>
        <div className="grid grid-cols-6 gap-3">
          {Object.entries(ALERTS.reduce((a,al)=>{a[al.type]=(a[al.type]||0)+1;return a;},{})).map(([type,cnt])=>(
            <div key={type} className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-800">
              <div className="text-xl font-black text-sky-400">{cnt}</div>
              <div className="text-[10px] text-slate-500 mt-1 capitalize">{type}</div>
            </div>
          ))}
        </div>
      </div>
      <Disclaimer />
    </div>
  );
};

// ─── INBOX / CHAT ─────────────────────────────────────────────────────────
const InboxView = () => {
  const [selected, setSelected] = useState(null);
  const [newMsg, setNewMsg] = useState("");
  const fileInputRef = useRef(null);
  const [attachError, setAttachError] = useState("");

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAttachError(`"${file.name}" supera el límite de 5 MB. Tamaño: ${(file.size/1024/1024).toFixed(1)} MB`);
    } else {
      setAttachError(`✓ Archivo seleccionado: ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)`);
      setTimeout(() => setAttachError(""), 3000);
    }
    e.target.value = "";
  };

  return (
    <div className="flex gap-5 h-[70vh]">
      {/* Lista de conversaciones */}
      <div className="w-64 flex-shrink-0 bg-[#131920] rounded-xl border border-slate-800 overflow-y-auto">
        <div className="px-3 py-3 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">Conversaciones</div>
        {MESSAGES.map(msg => {
          const from = getProf(msg.from);
          const to   = getProf(msg.to);
          return (
            <div key={msg.id} onClick={() => setSelected(msg)}
              className={`p-3 border-b border-slate-800/50 cursor-pointer hover:bg-[#1a2332] transition-colors
                ${selected?.id === msg.id ? "bg-[#1a2332] border-l-2 border-l-sky-500" : ""}
                ${!msg.read ? "bg-slate-800/20" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <ProfAvatar id={msg.from} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-semibold ${!msg.read ? "text-white" : "text-slate-300"} truncate`}>
                    {from?.initials} → {to?.initials}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">{msg.patient}</div>
                </div>
                {!msg.read && <div className="w-2 h-2 bg-sky-400 rounded-full flex-shrink-0"></div>}
              </div>
              <div className="text-[10px] text-slate-500 truncate">{msg.text}</div>
              {msg.important && <div className="text-[10px] text-yellow-400 mt-0.5">★ Importante</div>}
            </div>
          );
        })}
      </div>

      {/* Panel de mensaje */}
      <div className="flex-1 bg-[#131920] rounded-xl border border-slate-800 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3">
              <ProfAvatar id={selected.from} />
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  {getProf(selected.from)?.name} → {getProf(selected.to)?.name}
                </div>
                <div className="text-xs text-slate-500">Caso: {selected.patient} · {selected.ts}</div>
              </div>
              {selected.important && <span className="ml-auto text-yellow-400 text-sm">★</span>}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="bg-slate-800/40 rounded-xl p-4 max-w-xl">
                <div className="text-xs text-slate-400 mb-1">{getProf(selected.from)?.name}</div>
                <div className="text-sm text-slate-200 leading-relaxed">{selected.text}</div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-800 space-y-2">
              <div className="text-[10px] text-orange-400 bg-orange-900/10 border border-orange-800/30 rounded px-2 py-1.5">
                ⚠ No usar como canal de urgencias vitales. Revisar protocolos institucionales.
              </div>
              {attachError && (
                <div className={`text-[10px] px-2 py-1.5 rounded border ${attachError.startsWith("✓") ? "text-emerald-400 bg-emerald-900/10 border-emerald-800/30" : "text-red-400 bg-red-900/10 border-red-800/30"}`}>
                  {attachError}
                </div>
              )}
              <div className="flex gap-2">
                <input value={newMsg} onChange={e=>setNewMsg(e.target.value)}
                  placeholder="Escribir respuesta…"
                  className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500" />
                <button onClick={()=>{fileInputRef.current.click()}}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-400 hover:text-slate-200 text-sm"
                  title="Adjuntar (máx 5MB)">📎</button>
                <button className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg font-medium transition-colors">Enviar</button>
                <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" className="hidden" onChange={handleFileChange} />
              </div>
              <div className="text-[10px] text-slate-600">Tipos permitidos: PDF, JPG, PNG, DOCX · Máx. 5 MB por archivo</div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
            Selecciona una conversación
          </div>
        )}
      </div>
    </div>
  );
};

// ─── CONFIGURACIÓN / USUARIOS Y PERMISOS ────────────────────────────────
const UserAccessAdminPanel = ({ authSession, activeInstitution, onDataChanged }) => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [professionals, setProfessionals] = useState([]);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("todos");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    email: "",
    fullName: "",
    institutionId: "",
    role: "psiquiatra",
    professionalId: "",
    status: "approved",
    createProfessional: true,
  });

  const roleOptions = [
    ["admin", "Administrador institucional"],
    ["psiquiatra_jefe", "Psiquiatra jefe"],
    ["psiquiatra", "Psiquiatra"],
    ["medico_general", "Médico general"],
    ["psicologo", "Psicólogo/a"],
    ["enfermero", "Enfermero/a"],
    ["tens", "TENS"],
    ["terapeuta_ocupacional", "Terapeuta ocupacional"],
    ["trabajador_social", "Trabajador/a social"],
    ["solo_lectura", "Solo lectura"],
  ];
  const roleLabel = Object.fromEntries(roleOptions);
  const statusLabel = {
    approved: "Aprobado",
    pending: "Pendiente",
    rejected: "Rechazado",
    suspended: "Suspendido",
    sin_acceso: "Sin acceso",
  };

  const buildRows = ({ memberships = [], profiles = [] }) => {
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    const seenMembershipUsers = new Set();
    const membershipRows = (memberships || []).map(m => {
      const profile = profileMap.get(m.user_id) || {};
      seenMembershipUsers.add(m.user_id);
      return {
        kind: "membership",
        id: m.id,
        membershipId: m.id,
        userId: m.user_id,
        email: profile.email || m.user_id,
        fullName: profile.full_name || "Sin nombre",
        isProfileActive: profile.is_active !== false,
        provider: profile.created_by_auth_provider || "—",
        institutionId: m.institution_id,
        institutionName: m.institutions?.name || "—",
        institutionSlug: m.institutions?.slug,
        role: m.role,
        professionalId: m.professional_id || "",
        professionalName: m.professionals?.full_name || "Sin asociar",
        status: m.status || "approved",
        isActive: m.is_active !== false,
        isDefault: Boolean(m.is_default),
      };
    });
    const pendingRows = (profiles || [])
      .filter(p => !seenMembershipUsers.has(p.id))
      .map(p => ({
        kind: "profile",
        id: `profile-${p.id}`,
        membershipId: null,
        userId: p.id,
        email: p.email,
        fullName: p.full_name || "Sin nombre",
        isProfileActive: p.is_active !== false,
        provider: p.created_by_auth_provider || "—",
        institutionId: "",
        institutionName: "Sin institución",
        institutionSlug: "",
        role: "sin_rol",
        professionalId: "",
        professionalName: "Sin asociar",
        status: "sin_acceso",
        isActive: p.is_active !== false,
        isDefault: false,
      }));
    return [...pendingRows, ...membershipRows].sort((a, b) => {
      const statusOrder = { sin_acceso: 0, pending: 1, approved: 2, suspended: 3, rejected: 4 };
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return `${a.email}-${a.institutionName}`.localeCompare(`${b.email}-${b.institutionName}`);
    });
  };

  const loadAccessData = async () => {
    if (!authSession?.user?.id || !isSupabaseConfigured) return;
    setLoading(true);
    setMessage("");
    try {
      const [membershipsRes, profilesRes, institutionsRes, professionalsRes] = await Promise.all([
        supabase
          .from("memberships")
          .select("id,user_id,institution_id,professional_id,role,status,is_active,is_default,created_at,institutions(id,name,slug),professionals(id,full_name,role,email,initials)")
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id,email,full_name,is_active,created_by_auth_provider,created_at")
          .order("created_at", { ascending: false }),
        supabase.from("institutions").select("id,name,slug,kind").order("name"),
        supabase.from("professionals").select("id,institution_id,full_name,role,email,initials").order("full_name"),
      ]);
      const err = membershipsRes.error || profilesRes.error || institutionsRes.error || professionalsRes.error;
      if (err) throw err;
      const profilesData = profilesRes.data || [];
      const membershipsData = membershipsRes.data || [];
      setProfiles(profilesData);
      setRows(buildRows({ memberships: membershipsData, profiles: profilesData }));
      setInstitutions(institutionsRes.data || []);
      setProfessionals(professionalsRes.data || []);
      const activeDbId = getMembershipForWorkspace(activeInstitution)?.institutionDbId;
      setForm(prev => ({ ...prev, institutionId: prev.institutionId || activeDbId || institutionsRes.data?.[0]?.id || "" }));
    } catch (error) {
      setMessage(error?.message || "No se pudieron cargar usuarios y permisos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAccessData(); }, [authSession?.user?.id, activeInstitution]);

  const filteredProfessionals = professionals.filter(p => !form.institutionId || p.institution_id === form.institutionId);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows.filter(row => {
    const matchesFilter = filter === "todos" ||
      (filter === "sin_acceso" && row.status === "sin_acceso") ||
      (filter === "approved" && row.status === "approved") ||
      (filter === "pending" && row.status === "pending") ||
      (filter === "suspended" && row.status === "suspended") ||
      (filter === "rejected" && row.status === "rejected");
    const matchesQuery = !normalizedQuery ||
      row.email?.toLowerCase().includes(normalizedQuery) ||
      row.fullName?.toLowerCase().includes(normalizedQuery) ||
      row.institutionName?.toLowerCase().includes(normalizedQuery) ||
      row.professionalName?.toLowerCase().includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });

  const getProfileByEmail = (email) => profiles.find(p => p.email?.toLowerCase() === email?.trim().toLowerCase());

  const handleEmailChange = (email) => {
    const profile = getProfileByEmail(email);
    setForm(prev => ({
      ...prev,
      email,
      fullName: profile?.full_name && !prev.fullName ? profile.full_name : prev.fullName,
    }));
  };

  const prefillFromRow = (row) => {
    setForm({
      email: row.email || "",
      fullName: row.fullName || "",
      institutionId: row.institutionId || form.institutionId || institutions[0]?.id || "",
      role: row.role && row.role !== "sin_rol" ? row.role : "psiquiatra",
      professionalId: row.professionalId || "",
      status: row.status && row.status !== "sin_acceso" ? row.status : "approved",
      createProfessional: !row.professionalId,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleAssign = async (e) => {
    e?.preventDefault?.();
    setLoading(true);
    setMessage("");
    try {
      if (!form.email.trim()) throw new Error("Escribe el email del usuario.");
      if (!form.institutionId) throw new Error("Selecciona institución.");
      const profile = getProfileByEmail(form.email);
      const finalName = form.fullName.trim() || profile?.full_name || form.email.split("@")[0];
      const { error } = await supabase.rpc("clincoord_assign_membership_v2", {
        p_email: form.email.trim().toLowerCase(),
        p_institution_id: form.institutionId,
        p_role: form.role,
        p_professional_id: form.professionalId || null,
        p_status: form.status,
        p_full_name: finalName,
        p_create_professional: Boolean(form.createProfessional || !form.professionalId),
      });
      if (error) throw error;
      setMessage("Permiso guardado. Si el usuario está conectado, debe recargar o volver a iniciar sesión.");
      setForm(prev => ({ ...prev, email: "", fullName: "", professionalId: "", createProfessional: true }));
      await loadAccessData();
      onDataChanged?.();
    } catch (error) {
      setMessage(error?.message || "No se pudo guardar el permiso.");
    } finally {
      setLoading(false);
    }
  };

  const quickStatus = async (row, status) => {
    if (!row.email || !row.institutionId) return;
    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase.rpc("clincoord_assign_membership_v2", {
        p_email: row.email.toLowerCase(),
        p_institution_id: row.institutionId,
        p_role: row.role && row.role !== "sin_rol" ? row.role : "solo_lectura",
        p_professional_id: row.professionalId || null,
        p_status: status,
        p_full_name: row.fullName || row.email.split("@")[0],
        p_create_professional: false,
      });
      if (error) throw error;
      setMessage(status === "approved" ? "Usuario aprobado." : status === "suspended" ? "Acceso suspendido." : "Estado actualizado.");
      await loadAccessData();
      onDataChanged?.();
    } catch (error) {
      setMessage(error?.message || "No se pudo actualizar el estado.");
    } finally {
      setLoading(false);
    }
  };

  if (!authSession) return null;

  return (
    <div className="bg-[#131920] rounded-xl border border-slate-800 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-slate-300 font-semibold text-sm">Usuarios y permisos</div>
          <div className="text-xs text-slate-500 mt-1">El login crea identidad; esta sección asigna institución, rol, estado y registro profesional asociado.</div>
        </div>
        <button onClick={loadAccessData} disabled={loading} className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800">{loading ? "Cargando…" : "Actualizar"}</button>
      </div>

      <form onSubmit={handleAssign} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Email del usuario</label>
          <input value={form.email} onChange={e => handleEmailChange(e.target.value)} placeholder="usuario@correo.com" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
          <div className="mt-1 text-[10px] text-slate-500">El usuario debe haber iniciado sesión con Google/email o existir en Supabase Auth.</div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Nombre visible</label>
          <input value={form.fullName} onChange={e => setForm({...form, fullName:e.target.value})} placeholder="Nombre que verá el equipo" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
          <div className="mt-1 text-[10px] text-slate-500">También actualiza el registro profesional si se crea automáticamente.</div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Institución</label>
          <select value={form.institutionId} onChange={e => setForm({...form, institutionId:e.target.value, professionalId:""})} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
            {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Rol</label>
          <select value={form.role} onChange={e => setForm({...form, role:e.target.value, createProfessional: e.target.value !== "solo_lectura"})} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
            {roleOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Registro profesional asociado</label>
          <select value={form.professionalId} onChange={e => setForm({...form, professionalId:e.target.value, createProfessional: !e.target.value})} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
            <option value="">Sin asociar / crear automáticamente</option>
            {filteredProfessionals.map(p => <option key={p.id} value={p.id}>{p.full_name} · {roleLabel[p.role] || p.role}</option>)}
          </select>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
            <input type="checkbox" checked={form.createProfessional} onChange={e => setForm({...form, createProfessional:e.target.checked})} className="accent-sky-500" />
            Crear/actualizar registro profesional si no hay uno seleccionado
          </label>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Estado</label>
          <select value={form.status} onChange={e => setForm({...form, status:e.target.value})} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500">
            <option value="approved">Aprobado</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">Rechazado</option>
            <option value="suspended">Suspendido</option>
          </select>
        </div>
        <div className="md:col-span-2 flex items-center justify-end gap-2">
          <button type="button" onClick={() => setForm({ email:"", fullName:"", institutionId: form.institutionId, role:"psiquiatra", professionalId:"", status:"approved", createProfessional:true })} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800">Limpiar</button>
          <button type="submit" disabled={loading} className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-black text-white hover:bg-sky-500 disabled:opacity-60">Guardar permiso</button>
        </div>
      </form>

      {message && <div className={`mt-3 rounded-xl border p-3 text-xs ${message.toLowerCase().includes("no") || message.toLowerCase().includes("error") ? "border-red-800 bg-red-900/20 text-red-300" : "border-amber-800 bg-amber-900/20 text-amber-300"}`}>{message}</div>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar usuario, email, institución…" className="min-w-[240px] flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
        {[
          ["todos", "Todos"], ["sin_acceso", "Sin acceso"], ["pending", "Pendientes"], ["approved", "Aprobados"], ["suspended", "Suspendidos"], ["rejected", "Rechazados"]
        ].map(([value,label]) => (
          <button key={value} onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === value ? "border-sky-500 bg-sky-600 text-white" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}>{label}</button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full min-w-[920px] text-xs">
          <thead className="bg-slate-900/70 text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left">Usuario</th>
              <th className="px-3 py-2 text-left">Institución</th>
              <th className="px-3 py-2 text-left">Rol</th>
              <th className="px-3 py-2 text-left">Profesional</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(r => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-200">{r.fullName || "—"}</div>
                  <div className="text-slate-500">{r.email || r.userId}</div>
                  <div className="text-[10px] text-slate-600">{r.provider}</div>
                </td>
                <td className="px-3 py-2 text-slate-300">{r.institutionName || "Sin institución"}{r.isDefault && <span className="ml-1 text-[10px] text-sky-400">· default</span>}</td>
                <td className="px-3 py-2 text-sky-400 font-semibold">{roleLabel[r.role] || r.role || "Sin rol"}</td>
                <td className="px-3 py-2 text-slate-400">{r.professionalName || "Sin asociar"}</td>
                <td className="px-3 py-2"><span className={`rounded-full border px-2 py-0.5 ${r.status === "approved" ? "border-emerald-700 text-emerald-400" : r.status === "suspended" ? "border-red-700 text-red-400" : r.status === "sin_acceso" ? "border-slate-700 text-slate-400" : "border-amber-700 text-amber-400"}`}>{statusLabel[r.status] || r.status || "—"}</span></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => prefillFromRow(r)} className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800">Editar/asignar</button>
                    {r.kind === "membership" && r.status !== "approved" && <button onClick={() => quickStatus(r, "approved")} className="rounded-lg border border-emerald-700 px-2 py-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-900/20">Aprobar</button>}
                    {r.kind === "membership" && r.status !== "suspended" && <button onClick={() => quickStatus(r, "suspended")} className="rounded-lg border border-red-700 px-2 py-1 text-[10px] font-bold text-red-400 hover:bg-red-900/20">Suspender</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">Sin usuarios visibles para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ConfiguracionView = ({ activeInstitution, setActiveInstitution, themeMode, setThemeMode, activeUser, setActiveUser, authSession, onDataChanged }) => (
  <div className="space-y-5 max-w-5xl">
    <div className="bg-[#131920] rounded-xl border border-slate-800 p-5">
      <div className="text-slate-300 font-semibold text-sm mb-4">Espacios institucionales</div>
      <InstitutionSwitcher activeInstitution={activeInstitution} setActiveInstitution={setActiveInstitution} compact />
      <p className="mt-3 text-xs text-slate-500 leading-relaxed">
        Una cuenta puede tener membresías en varias instituciones. Al cambiar de espacio, pacientes, profesionales, programas, alertas y archivos se filtran por permisos reales de Supabase.
      </p>
    </div>
    <UserAccessAdminPanel authSession={authSession} activeInstitution={activeInstitution} onDataChanged={onDataChanged} />
    <div className="bg-[#131920] rounded-xl border border-slate-800 p-5">
      <div className="text-slate-300 font-semibold text-sm mb-4">Apariencia</div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">Modo {themeMode === "light" ? "claro" : "oscuro"}</div>
          <div className="text-xs text-slate-500">Cambia la interfaz completa sin alterar los datos visibles.</div>
        </div>
        <button onClick={() => setThemeMode(themeMode === "light" ? "dark" : "light")} className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500">
          {themeMode === "light" ? "Usar oscuro" : "Usar claro"}
        </button>
      </div>
    </div>
    <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-4">
      <div className="text-red-400 font-semibold text-sm mb-2">⚠ Aviso de privacidad</div>
      <p className="text-xs text-red-300/70 leading-relaxed">
        Todavía recomendamos usar solo datos ficticios hasta completar revisión de seguridad, respaldos, auditoría e invitaciones institucionales.
      </p>
    </div>
    <Disclaimer />
  </div>
);


// ─── PUERTA DE LOGIN REAL / DEMO ─────────────────────────────────────────
const AuthGate = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login");
  const [message, setMessage] = useState("");
  const [demoUnlocked, setDemoUnlocked] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data?.session || null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  const handleAuth = async (event) => {
    event.preventDefault();
    setMessage("");
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setMessage("Escribe email y contraseña.");
      return;
    }
    const action = mode === "signup"
      ? supabase.auth.signUp({ email: cleanEmail, password })
      : supabase.auth.signInWithPassword({ email: cleanEmail, password });
    const { error } = await action;
    if (error) {
      setMessage(error.message || "No se pudo iniciar sesión.");
      return;
    }
    if (mode === "signup") {
      setMessage("Usuario creado. Si Supabase pide confirmar correo, revisa el email antes de entrar.");
    }
  };

  const handleGoogleLogin = async () => {
    setMessage("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) setMessage(error.message || "No se pudo iniciar sesión con Google.");
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setSession(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080d13] text-slate-100 flex items-center justify-center p-6">
        <div className="rounded-2xl border border-slate-800 bg-[#131920] p-6 text-sm text-slate-300">Cargando sesión segura…</div>
      </div>
    );
  }

  if (!isSupabaseConfigured && !demoUnlocked) {
    setDemoUnlocked(true);
  }

  if (!isSupabaseConfigured && demoUnlocked) {
    return children({ authSession: null, authProfile: { appUserId: "admin", institution: "centro_medico", label: "Modo demo sin login real" }, onLogout: null, authLocked: false });
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#080d13] text-slate-100 flex items-center justify-center p-4" style={{ fontFamily:"'DM Sans', ui-sans-serif, system-ui, sans-serif" }}>
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-[#131920] p-6 shadow-2xl shadow-black/50">
          <div className="mb-6">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-lg font-black text-white">CC</div>
            <div className="mt-4 text-2xl font-black text-white">ClinCoord Mental</div>
            <div className="mt-1 text-sm text-slate-400">Etapa 7 · Usuarios, permisos y acceso institucional</div>
          </div>
          <button onClick={handleGoogleLogin} className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-black text-slate-100 hover:bg-slate-800">
            <span className="text-lg">G</span> Continuar con Google
          </button>
          <div className="mb-4 flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-600"><span className="h-px flex-1 bg-slate-800"></span>Email y contraseña<span className="h-px flex-1 bg-slate-800"></span></div>
          <form onSubmit={handleAuth} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="admin@clincoord.demo" className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-sky-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Contraseña</label>
              <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="mínimo 6 caracteres" className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none focus:border-sky-500" />
            </div>
            {message && <div className="rounded-xl border border-amber-800 bg-amber-900/20 p-3 text-xs text-amber-300">{message}</div>}
            <button type="submit" className="w-full rounded-2xl bg-sky-600 px-4 py-3 text-sm font-black text-white hover:bg-sky-500">
              {mode === "signup" ? "Crear usuario" : "Entrar"}
            </button>
          </form>
          <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); }} className="mt-4 w-full rounded-2xl border border-slate-700 px-4 py-3 text-xs font-bold text-slate-300 hover:bg-slate-800">
            {mode === "signup" ? "Ya tengo cuenta" : "Crear cuenta nueva"}
          </button>
          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-500">
            Ingresa con email/contraseña o Google. Si tu cuenta aún no tiene acceso, quedará pendiente hasta que un superadmin o administrador institucional le asigne permisos.
          </div>
        </div>
      </div>
    );
  }

  const authProfile = getAuthProfileFromEmail(session.user?.email);
  return children({ authSession: session, authProfile, onLogout: handleLogout, authLocked: true });
};

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────
function ClinCoordApp({ authSession, authProfile, onLogout, authLocked = false }) {
  const [page, setPage]     = useState("dashboard");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("desktop");
  const [activeInstitution, setActiveInstitutionRaw] = useState(authProfile?.institution || "centro_medico");
  const [activeUser, setActiveUser] = useState(authProfile?.appUserId || "admin");
  const [themeMode, setThemeMode] = useState("dark");
  const [dataVersion, setDataVersion] = useState(0);
  const [dbState, setDbState] = useState({ loading: Boolean(authLocked && isSupabaseConfigured), error: "", source: authLocked ? "supabase" : "demo" });
  const [runtimeAuthProfile, setRuntimeAuthProfile] = useState(authProfile);

  useEffect(() => {
    if (!authProfile) return;
    setRuntimeAuthProfile(authProfile);
    setActiveInstitutionRaw(authProfile.institution || "centro_medico");
    setActiveUser(authProfile.appUserId || "admin");
    setSearch("");
  }, [authProfile?.appUserId, authProfile?.institution]);

  const refreshWorkspaceData = async () => {
    if (!authLocked || !authSession?.user?.id || !isSupabaseConfigured) {
      setDbState({ loading: false, error: "", source: "demo" });
      return;
    }
    setDbState({ loading: true, error: "", source: "supabase" });
    try {
      const { authProfile: dbAuthProfile } = await loadWorkspaceDataFromSupabase(authSession);
      setRuntimeAuthProfile(dbAuthProfile);
      setActiveInstitutionRaw(dbAuthProfile?.institution || "centro_medico");
      setActiveUser(getAppUserIdForWorkspace(dbAuthProfile?.institution || "centro_medico", dbAuthProfile?.appUserId || "admin"));
      setSearch("");
      setDataVersion(v => v + 1);
      setDbState({ loading: false, error: "", source: "supabase" });
    } catch (error) {
      console.error("Error cargando datos desde Supabase", error);
      setDbState({ loading: false, error: error?.message || "No se pudieron cargar los datos desde Supabase.", source: "supabase" });
    }
  };

  useEffect(() => {
    refreshWorkspaceData();
  }, [authLocked, authSession?.user?.id, authSession?.access_token]);

  if (dbState.loading) {
    return (
      <div className="min-h-screen bg-[#080d13] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-slate-800 bg-[#131920] p-6 text-center shadow-2xl shadow-black/40">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white font-black">CC</div>
          <div className="text-lg font-black text-white">Cargando datos reales desde Supabase…</div>
          <div className="mt-2 text-sm text-slate-400">Aplicando permisos por institución y equipo tratante.</div>
        </div>
      </div>
    );
  }

  if (dbState.error) {
    return (
      <div className="min-h-screen bg-[#080d13] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-lg rounded-3xl border border-red-800 bg-[#131920] p-6 shadow-2xl shadow-black/40">
          <div className="text-xl font-black text-red-400">No se pudieron cargar los datos</div>
          <div className="mt-3 rounded-2xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">{dbState.error}</div>
          <div className="mt-4 text-sm text-slate-400">Si acabas de crear la cuenta, puede que aún esté sin acceso asignado. Un superadmin o administrador institucional debe aprobarla en Configuración → Usuarios y permisos.</div>
          {onLogout && <button onClick={onLogout} className="mt-5 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-black text-white hover:bg-sky-500">Cerrar sesión</button>}
        </div>
      </div>
    );
  }

  const effectiveAuthProfile = runtimeAuthProfile || authProfile;
  const setActiveInstitution = (institutionId) => {
    setActiveInstitutionRaw(institutionId);
    setActiveUser(authLocked ? getAppUserIdForWorkspace(institutionId, effectiveAuthProfile?.appUserId || "admin") : "admin");
    setSearch("");
  };
  ACTIVE_INSTITUTION_ID = activeInstitution;
  ACTIVE_USER_ID = activeUser;
  const isMobileView = viewMode === "mobile";

  const PAGE_TITLES = {
    dashboard:"Dashboard", pacientes:"Pacientes", profesionales:"Profesionales",
    alertas:"Alertas y Controles", farmacoterapia:"Farmacoterapia / Tratamientos",
    clozapina:"Programa Clozapina", inyectables:"Inyectables de Depósito",
    trazabilidad:"Trazabilidad / Auditoría", estadisticas:"Estadísticas",
    inbox:"Inbox / Chat interno", configuracion:"Configuración",
  };

  const renderPage = () => (
    <div key={`${activeInstitution}-${page}-${dataVersion}`} className="space-y-5">
      <InstitutionSummary activeInstitution={activeInstitution} />
      {page === "dashboard"      && <Dashboard setPage={setPage} />}
      {page === "pacientes"      && <PacientesView search={search} workspaceKey={activeInstitution} activeInstitution={activeInstitution} authSession={authSession} authProfile={effectiveAuthProfile} onDataChanged={refreshWorkspaceData} />}
      {page === "profesionales"  && <ProfesionalesView />}
      {page === "alertas"        && <AlertasView />}
      {page === "farmacoterapia" && <FarmacoterapiaView />}
      {page === "clozapina"      && <ProgramaClozapinaView authSession={authSession} onDataChanged={refreshWorkspaceData} />}
      {page === "inyectables"    && <ProgramaInyectablesView authSession={authSession} onDataChanged={refreshWorkspaceData} />}
      {page === "trazabilidad"   && <TrazabilidadView />}
      {page === "estadisticas"   && <EstadisticasView />}
      {page === "inbox"          && <InboxView />}
      {page === "configuracion"  && <ConfiguracionView activeInstitution={activeInstitution} setActiveInstitution={setActiveInstitution} themeMode={themeMode} setThemeMode={setThemeMode} activeUser={activeUser} setActiveUser={setActiveUser} authSession={authSession} onDataChanged={refreshWorkspaceData} />}
    </div>
  );

  return (
    <div className={`min-h-screen bg-[#080d13] text-slate-100 ${themeMode === "light" ? "light-theme" : "dark-theme"} ${isMobileView ? "mobile-shell" : "flex"}`}
      style={{ fontFamily:"'DM Sans', 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,400&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #475569; }
        .light-theme {
          background: #f8fafc !important;
          color: #0f172a !important;
        }
        .light-theme [class*="bg-[#0d1117]"],
        .light-theme [class*="bg-[#131920]"],
        .light-theme [class*="bg-[#1a2332]"] {
          background-color: #ffffff !important;
        }
        .light-theme [class*="bg-slate-900"],
        .light-theme [class*="bg-slate-800"],
        .light-theme [class*="bg-slate-700"] {
          background-color: #f1f5f9 !important;
        }
        .light-theme [class*="border-slate-800"],
        .light-theme [class*="border-slate-700"],
        .light-theme [class*="border-slate-600"] {
          border-color: #cbd5e1 !important;
        }
        .light-theme [class*="text-slate-100"],
        .light-theme [class*="text-slate-200"],
        .light-theme [class*="text-slate-300"],
        .light-theme .text-white {
          color: #0f172a !important;
        }
        .light-theme [class*="text-slate-400"] { color: #475569 !important; }
        .light-theme [class*="text-slate-500"],
        .light-theme [class*="text-slate-600"] { color: #64748b !important; }
        .light-theme [class*="placeholder-slate-500"]::placeholder { color: #94a3b8 !important; }
        .light-theme [class*="bg-sky-600"],
        .light-theme [class*="bg-red-500"],
        .light-theme [class*="bg-violet-600"],
        .light-theme [class*="bg-indigo-600"],
        .light-theme [class*="bg-teal-600"],
        .light-theme [class*="bg-pink-600"],
        .light-theme [class*="bg-amber-600"],
        .light-theme [class*="bg-cyan-600"],
        .light-theme [class*="bg-rose-600"] {
          color: #ffffff !important;
        }
        .light-theme .light-control {
          background: #ffffff !important;
          color: #0f172a !important;
          border-color: #cbd5e1 !important;
        }
        .mobile-shell {
          width: min(100vw, 430px);
          min-height: 100vh;
          margin: 0 auto;
          position: relative;
          overflow-x: hidden;
          border-left: 1px solid rgba(30, 41, 59, 0.8);
          border-right: 1px solid rgba(30, 41, 59, 0.8);
          box-shadow: 0 0 50px rgba(0, 0, 0, 0.45);
        }
        .mobile-shell .grid { grid-template-columns: minmax(0, 1fr) !important; }
        .mobile-shell .overflow-hidden { overflow-x: auto !important; }
        .mobile-shell table { min-width: 680px; }
        .mobile-shell [class*="h-[70vh]"] { height: auto !important; min-height: 70vh; }
        .mobile-shell [class*="w-64"] { width: 100% !important; }
        .mobile-shell [class*="max-w-2xl"] { max-width: 430px !important; }
        .mobile-shell .fixed.inset-0 { align-items: stretch !important; justify-content: center !important; }
        .mobile-shell .fixed.inset-0 > div { width: min(100vw, 430px) !important; border-left: 0 !important; }
        .mobile-shell main { padding: 0.85rem 0.85rem 6.75rem; }
        @media (max-width: 520px) {
          .mobile-shell { width: 100vw; border-left: 0; border-right: 0; box-shadow: none; }
          .mobile-shell .fixed.inset-0 > div { width: 100vw !important; max-width: 100vw !important; }
        }
      `}</style>

      <ThemeToggle themeMode={themeMode} setThemeMode={setThemeMode} />
      <ViewModeToggle mode={viewMode} setMode={setViewMode} />

      {isMobileView ? (
        <>
          <MobileTopbar title={PAGE_TITLES[page]} search={search} setSearch={setSearch} activeInstitution={activeInstitution} setActiveInstitution={setActiveInstitution} activeUser={activeUser} setActiveUser={setActiveUser} authLocked={authLocked} authEmail={authSession?.user?.email} onLogout={onLogout} />
          <main>
            {renderPage()}
          </main>
          <MobileBottomNav active={page} setActive={setPage} />
        </>
      ) : (
        <>
          <Sidebar active={page} setActive={setPage} />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <Topbar title={PAGE_TITLES[page]} search={search} setSearch={setSearch} activeInstitution={activeInstitution} setActiveInstitution={setActiveInstitution} activeUser={activeUser} setActiveUser={setActiveUser} authLocked={authLocked} authEmail={authSession?.user?.email} onLogout={onLogout} />
            <main className="flex-1 overflow-y-auto p-6">
              {renderPage()}
            </main>
          </div>
        </>
      )}
    </div>
  );
}


export default function App() {
  return (
    <AuthGate>
      {({ authSession, authProfile, onLogout, authLocked }) => (
        <ClinCoordApp authSession={authSession} authProfile={authProfile} onLogout={onLogout} authLocked={authLocked} />
      )}
    </AuthGate>
  );
}
