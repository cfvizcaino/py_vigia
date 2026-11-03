import type { Metadata } from "next";
import { SiteClosing, SiteFooter, SiteHeader } from "@/components/site";

export const metadata: Metadata = {
  title: "Nosotros | VIGÍA",
  description: "VIGÍA es un proyecto de ingeniería que combina inteligencia artificial y procesamiento distribuido para conectar observaciones vehiculares.",
};

const STORY = [
  { title: "Información fragmentada", text: "Las cámaras capturan información valiosa, pero analizarla de forma conjunta sigue siendo un desafío." },
  { title: "De la idea a la tecnología", text: "Integramos inteligencia artificial y visión por computador para conectar observaciones vehiculares." },
  { title: "Más allá del prototipo", text: "Evolucionamos nuestro prototipo hacia una plataforma escalable para seguridad y movilidad." },
];

export default function Nosotros() {
  return <div className="site about">
    <SiteHeader current="nosotros"/>
    <main>
      <section className="hero about-hero" aria-labelledby="about-title">
        <h1 id="about-title">Innovación que nace de un desafío real.</h1>
        <p>Somos VIGÍA, un proyecto de ingeniería que combina inteligencia artificial y tecnología para desarrollar nuevas soluciones de análisis vehicular.</p>
      </section>
      <section className="origin" aria-labelledby="origin-title">
        <p className="section-label">Nuestro origen</p>
        <h2 id="origin-title" className="gray-title">Todo comenzó con una pregunta: <span>¿cómo conectar lo que las cámaras ven por separado?</span></h2>
        <ol className="origin-steps">
          {STORY.map((item, index) => <li key={item.title} className={index === 1 ? "featured" : ""}><h3>{item.title}</h3><p>{item.text}</p></li>)}
        </ol>
      </section>
      <section className="mission" aria-labelledby="mission-title">
        <p className="section-label">Misión</p>
        <h2 id="mission-title" className="gray-title">Convertir información dispersa en <span>conocimiento útil.</span></h2>
        <p>Desarrollar tecnología que permita aprovechar observaciones vehiculares mediante inteligencia artificial, procesamiento distribuido y herramientas de análisis accesibles para operadores autorizados.</p>
      </section>
      <SiteClosing/>
    </main>
    <SiteFooter/>
  </div>;
}
