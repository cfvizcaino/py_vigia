import type { Metadata } from "next";
import { SiteClosing, SiteFooter, SiteHeader, SiteMotion } from "@/components/site";

export const metadata: Metadata = {
  title: "Nosotros | VIGÍA",
  description: "VIGÍA es un proyecto de ingeniería que combina inteligencia artificial y procesamiento distribuido para conectar observaciones vehiculares.",
};

const STORY = [
  { title: "Información fragmentada", text: "Las cámaras capturan información valiosa, pero analizarla de forma conjunta sigue siendo un desafío." },
  { title: "De la idea a la tecnología", text: "Integramos inteligencia artificial y visión por computador para conectar observaciones vehiculares." },
  { title: "Más allá del prototipo", text: "Evolucionamos nuestro prototipo hacia una plataforma escalable para seguridad y movilidad." },
];

const TEAM = [
  { name: "Cristian Vizcaíno", github: "cfvizcaino" },
  { name: "Juan Delgado", github: "Deelgado" },
  { name: "Daniel Castañeda", github: "DanielCM21" },
];

const TUTORS = ["Augusto Salazar", "Diana Roca"];

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("");
}

export default function Nosotros() {
  return <SiteMotion className="site about">
    <SiteHeader current="nosotros"/>
    <main>
      <section className="hero about-hero" aria-labelledby="about-title">
        <h1 id="about-title" data-enter>Innovación que nace de un desafío real.</h1>
        <p data-enter>Somos VIGÍA, un proyecto de ingeniería que combina inteligencia artificial y tecnología para desarrollar nuevas soluciones de análisis vehicular.</p>
      </section>
      <section className="origin" aria-labelledby="origin-title">
        <div data-reveal="stagger">
        <p className="section-label">Nuestro origen</p>
        <h2 id="origin-title" className="gray-title">Todo comenzó con una pregunta: <span>¿cómo conectar lo que las cámaras ven por separado?</span></h2>
        </div>
        <ol className="origin-steps" data-reveal="stagger">
          {STORY.map((item, index) => <li key={item.title} className={index === 1 ? "featured" : ""}><h3>{item.title}</h3><p>{item.text}</p></li>)}
        </ol>
      </section>
      <section className="mission" aria-labelledby="mission-title" data-reveal="stagger">
        <p className="section-label">Misión</p>
        <h2 id="mission-title" className="gray-title">Convertir información dispersa en <span>conocimiento útil.</span></h2>
        <p>Desarrollar tecnología que permita aprovechar observaciones vehiculares mediante inteligencia artificial, procesamiento distribuido y herramientas de análisis accesibles para operadores autorizados.</p>
      </section>
      <section className="mission vision" aria-labelledby="vision-title" data-reveal="stagger">
        <p className="section-label">Visión</p>
        <h2 id="vision-title" className="gray-title">Que las cámaras de una ciudad <span>vean como una sola.</span></h2>
        <p>Ser, en 2030, la plataforma de referencia en Colombia para reconstruir el recorrido de un vehículo a partir de cámaras distribuidas, y ayudar a las autoridades y operadores autorizados a responder con evidencia, rapidez y respeto por la privacidad.</p>
      </section>
      <section className="team" aria-labelledby="team-title">
        <div data-reveal="stagger">
          <p className="section-label">Equipo</p>
          <h2 id="team-title" className="gray-title">Las personas <span>detrás de VIGÍA.</span></h2>
        </div>
        <ul className="team-grid" data-reveal="stagger">
          {TEAM.map((person) => <li key={person.github}>
            <span className="team-avatar" aria-hidden="true">{initials(person.name)}</span>
            <h3>{person.name}</h3>
            <a href={`https://github.com/${person.github}`} target="_blank" rel="noreferrer">@{person.github}</a>
          </li>)}
        </ul>
        <p className="team-tutors" data-reveal><span>Tutores</span>{TUTORS.join(" · ")}</p>
      </section>
      <SiteClosing/>
    </main>
    <SiteFooter/>
  </SiteMotion>;
}
