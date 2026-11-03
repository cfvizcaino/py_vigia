import { existsSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppIndex, CopyButton, type Section } from "@/components/app-download";
import { Icon, type IconName } from "@/components/icon";
import { SiteFooter, SiteHeader } from "@/components/site";
import { backendUrl } from "@/lib/backend-api";

export const metadata: Metadata = {
  title: "App Android | VIGÍA",
  description: "Descarga la app de VIGÍA para Android: consulta trayectorias, registra edges y usa el teléfono como edge autónomo o como cámara de un nodo.",
};

// The version comes from the backend (written when an APK is published); refresh every 5 minutes.
export const revalidate = 300;

type Release = { latest: string | null; apk_url: string | null; sha256: string | null; published_at: string | null; size_bytes?: number | null; notes?: string };

async function currentRelease(): Promise<Release | null> {
  try {
    const response = await fetch(backendUrl("/app/version"), { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const release = await response.json() as Release;
    return release.latest ? release : null;
  } catch {
    return null;
  }
}

/** Real screenshots of the app, dropped in public/app/capturas/ (operador, edge, camara). */
function screenshot(name: string) {
  for (const extension of ["webp", "png", "jpg"]) {
    if (existsSync(path.join(process.cwd(), "public", "app", "capturas", `${name}.${extension}`))) return `/app/capturas/${name}.${extension}`;
  }
  return null;
}

const SECTIONS: Section[] = [
  { id: "descargar", label: "Descargar" },
  { id: "instalar", label: "Instalar" },
  { id: "operador", label: "Consultar como operador" },
  { id: "edge", label: "Edge autónomo" },
  { id: "camara", label: "Cámara de un nodo" },
  { id: "verificar", label: "Verificar el archivo" },
  { id: "iphone", label: "iPhone" },
];

const sizeLabel = (bytes: number) => `${(bytes / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
const dateLabel = (value: string) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));

function GuideSection({ id, icon, title, children }: { id: string; icon: IconName; title: string; children: ReactNode }) {
  return <section id={id} className="guide-section" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}><span className="guide-icon"><Icon name={icon} size={20}/></span>{title}</h2>
    {children}
  </section>;
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="guide-steps">{children}</ol>;
}

function Shot({ name, alt }: { name: string; alt: string }) {
  const src = screenshot(name);
  return src ? <figure className="guide-shot"><Image src={src} alt={alt} width={360} height={780} sizes="(max-width: 860px) 60vw, 240px"/></figure> : null;
}

export default async function AppPage() {
  const release = await currentRelease();
  const file = release?.apk_url ? new URL(release.apk_url).pathname : "/descargas/vigia.apk";
  const fileName = file.split("/").at(-1) ?? "vigia.apk";

  return <div className="site">
    <SiteHeader current="app"/>
    <div className="guide">
      <AppIndex sections={SECTIONS}/>
      <main className="guide-body">
        <section id="descargar" className="guide-hero" aria-labelledby="app-title">
          <h1 id="app-title">La app de VIGÍA, <span>en tu teléfono.</span></h1>
          <p>Consulta cámaras y trayectorias estimadas, registra edges y convierte el teléfono en un edge que detecta vehículos por sí mismo, o en la cámara de un nodo.</p>
          <a className="pill-light download-pill" href={file} download={fileName}><Icon name="download" size={18}/>Descargar para Android{release ? ` · v${release.latest}` : ""}</a>
          <dl className="release-sheet">
            <div><dt>Versión</dt><dd>{release?.latest ?? "Vigente"}</dd></div>
            {release?.size_bytes ? <div><dt>Tamaño</dt><dd>{sizeLabel(release.size_bytes)}</dd></div> : null}
            <div><dt>Requiere</dt><dd>Android 7.0+</dd></div>
            {release?.published_at ? <div><dt>Publicada</dt><dd>{dateLabel(release.published_at)}</dd></div> : null}
            {release?.sha256 ? <div className="release-hash"><dt>SHA-256</dt><dd><code>{release.sha256}</code><CopyButton value={release.sha256} label="Copiar el SHA-256 del APK"/></dd></div> : null}
          </dl>
          {!release && <p className="guide-note"><Icon name="alert" size={17}/>No pudimos leer la ficha de esta versión. El archivo es el mismo que publica el servidor.</p>}
          {release?.notes ? <p className="guide-note"><Icon name="layers" size={17}/>{release.notes}</p> : null}
        </section>

        <GuideSection id="instalar" icon="phone" title="Instalar en Android">
          <Steps>
            <li>Toca <b>Descargar</b> y abre el archivo cuando termine.</li>
            <li>Si el teléfono lo pide, permite <b>instalar apps de esta fuente</b> para el navegador.</li>
            <li>Abre <b>VIGÍA</b>: ya viene configurada con el servidor del piloto. Inicia sesión con la cuenta que te entregó el administrador.</li>
          </Steps>
          <p className="guide-note"><Icon name="shield" size={17}/>Instálala solo desde esta página. Las actualizaciones deben tener la misma firma: un archivo de otra fuente no se instalará encima.</p>
        </GuideSection>

        <GuideSection id="operador" icon="queries" title="Consultar como operador">
          <div className="guide-split">
            <div>
              <p>Con tu cuenta ves lo mismo que en la consola web, pensado para la calle:</p>
              <ul className="guide-list">
                <li><Icon name="pin" size={17}/>Las cámaras de la red en el mapa.</li>
                <li><Icon name="search" size={17}/>Consultas por punto, tipo de vehículo, color, fecha y radio.</li>
                <li><Icon name="route" size={17}/>Rutas candidatas con su puntaje y la explicación de cada tramo.</li>
                <li><Icon name="download" size={17}/>Exportación de resultados, registrada en la auditoría.</li>
              </ul>
              <p>Un administrador además registra edges desde <b>Edges → Agregar edge</b>.</p>
            </div>
            <Shot name="operador" alt="Pantalla de consultas de la app VIGÍA"/>
          </div>
        </GuideSection>

        <GuideSection id="edge" icon="signal" title="Usar el teléfono como edge autónomo">
          <div className="guide-split">
            <div>
              <Steps>
                <li>Un administrador registra el edge en <b>Edges → Agregar edge</b> con la fuente <b>Este teléfono · detección integrada</b>. Si lo hace desde el mismo teléfono, toca <b>Usar en este teléfono</b> y listo.</li>
                <li>Si lo registró desde otro teléfono: en la pantalla de inicio toca <b>Edge autónomo</b>, escribe el identificador, el servidor y el token, y toca <b>Verificar y guardar</b>.</li>
                <li>Toca <b>Iniciar detección</b>. Deja la app abierta y el teléfono en el cargador, con la cámara viendo la vía de lado o en diagonal.</li>
              </Steps>
              <p className="guide-note"><Icon name="lock" size={17}/>El teléfono detecta los vehículos con el modelo integrado: el video no sale del teléfono. Al servidor llegan los metadatos y un recorte pequeño de cada vehículo, que solo ve un administrador durante 7 días.</p>
            </div>
            <Shot name="edge" alt="Pantalla del edge autónomo de la app VIGÍA detectando vehículos"/>
          </div>
        </GuideSection>

        <GuideSection id="camara" icon="cable" title="Usar el teléfono como cámara de un nodo">
          <div className="guide-split">
            <div>
              <Steps>
                <li>En la pantalla de inicio toca <b>Usar este teléfono como cámara</b>. No hace falta iniciar sesión.</li>
                <li>Elige <b>Cable USB</b> (recomendado) o <b>Red local</b> y toca <b>Iniciar transmisión</b>.</li>
                <li>El administrador registra el edge en <b>Cámaras → Agregar edge</b> y conecta el teléfono al PC del nodo, que detecta los vehículos y publica al servidor.</li>
              </Steps>
              <p className="guide-note"><Icon name="lock" size={17}/>El video no sale de tu sitio: llega por cable o por la red local al PC del nodo, y al servidor solo los metadatos.</p>
            </div>
            <Shot name="camara" alt="Pantalla de transmisión de la app VIGÍA como cámara de un nodo"/>
          </div>
        </GuideSection>

        <GuideSection id="verificar" icon="fingerprint" title="Verificar el archivo">
          <p>La app comprueba el SHA-256 antes de instalar una actualización y avisa al abrirse cuando hay una versión nueva. Si descargas el APK en un computador, compara su huella con la de esta página:</p>
          <dl className="command-list">
            <div><dt>Linux</dt><dd><code>sha256sum {fileName}</code></dd></div>
            <div><dt>macOS</dt><dd><code>shasum -a 256 {fileName}</code></dd></div>
            <div><dt>Windows</dt><dd><code>Get-FileHash .\{fileName} -Algorithm SHA256</code></dd></div>
          </dl>
        </GuideSection>

        <GuideSection id="iphone" icon="clock" title="iPhone">
          <p>La versión para iPhone está compilada pero aún no tiene distribución: Apple exige una cuenta de desarrollador para instalarla fuera de Xcode. Mientras tanto, usa la <Link className="text-link" href="/?entrar=1">consola web</Link> en este mismo sitio.</p>
        </GuideSection>
      </main>
    </div>
    <SiteFooter/>
  </div>;
}
