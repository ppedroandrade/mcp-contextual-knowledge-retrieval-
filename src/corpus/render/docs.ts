import { brDate, FactSink, slugify, type SourceOutput } from '../model.js';
import type { Rng } from '../random.js';
import { HOWTOS, INCIDENTS, PRODUCT, SERVICES } from '../world.js';

interface Section { heading: string; text: string; facts?: Record<string, string> }

function markdown(id: string, title: string, meta: Record<string, string>, sections: Section[], sink: FactSink): string {
  const fm = [`id: ${id}`, `title: ${title}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`)].join('\n');
  const body = sections.map((s) => {
    for (const [factId, value] of Object.entries(s.facts ?? {})) {
      if (!s.text.includes(value)) throw new Error(`fato ${factId} não aparece no texto de ${id}`);
      sink.add(factId, value, id, slugify(s.heading));
    }
    return `## ${s.heading}\n\n${s.text}\n`;
  });
  return `---\n${fm}\n---\n\n# ${title}\n\n${body.join('\n')}`;
}

/** Wiki técnica: arquitetura e runbook de cada serviço, e guias práticos. */
export function renderDocs(rng: Rng): SourceOutput {
  const sink = new FactSink('docs');
  const files: SourceOutput['files'] = [];
  let n = 0;
  const nextId = () => `DOC-${String(++n).padStart(3, '0')}`;
  const updated = () => `2026-${String(rng.int(6, 9)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;

  for (const s of SERVICES) {
    const id = nextId();
    const f = (k: string) => `svc.${s.id}.${k}`;
    files.push({
      path: `docs/${id}.md`,
      content: markdown(id, `Arquitetura do ${s.name}`, { tipo: 'arquitetura', servico: s.id, atualizado: updated() }, [
        {
          heading: 'Visão geral',
          text: `O ${s.name} ${s.purpose}. O serviço é mantido pelo ${s.team} e é implementado em ${s.stack}. Faz parte da plataforma ${PRODUCT}.`,
          facts: { [f('time')]: s.team, [f('stack')]: s.stack },
        },
        {
          heading: 'Dados e dependências',
          text: `O ${s.name} persiste seus dados em ${s.datastore}. Mudanças de esquema seguem o processo de migração revisada pelo time responsável.`,
          facts: { [f('dados')]: s.datastore },
        },
        {
          heading: 'Confiabilidade',
          text: `O objetivo de nível de serviço (SLO) do ${s.name} é ${s.slo}. Em falhas temporárias, a política de novas tentativas é: ${s.retry}.`,
          facts: { [f('slo')]: s.slo, [f('retry')]: s.retry },
        },
      ], sink),
    });
  }

  for (const s of SERVICES) {
    const id = nextId();
    const f = (k: string) => `svc.${s.id}.${k}`;
    const past = INCIDENTS.filter((i) => i.service === s.id).map((i) => `- ${i.id} (${brDate(i.date)}): ${i.title}`);
    files.push({
      path: `docs/${id}.md`,
      content: markdown(id, `Runbook do ${s.name}`, { tipo: 'runbook', servico: s.id, atualizado: updated() }, [
        {
          heading: 'Verificação de saúde',
          text: `Para conferir se o ${s.name} está saudável, chame GET ${s.healthcheck} em cada instância. O alerta principal dispara quando há ${s.alert}.`,
          facts: { [f('healthcheck')]: s.healthcheck, [f('alerta')]: s.alert },
        },
        {
          heading: 'Rollback',
          text: `Se um deploy do ${s.name} causar erros, execute \`${s.rollback}\` e confirme a recuperação no endpoint de saúde. Registre o rollback no canal do plantão.`,
          facts: { [f('rollback')]: s.rollback },
        },
        {
          heading: 'Escalonamento',
          text: `Problemas no ${s.name} são tratados pelo plantão do ${s.team}, acionado pelo canal ${s.oncallChannel}. Se não houver resposta em 15 minutos, acione a liderança de engenharia.`,
          facts: { [f('plantao')]: s.oncallChannel },
        },
        {
          heading: 'Incidentes anteriores',
          text: past.length ? past.join('\n') : 'Nenhum incidente registrado em 2026.',
        },
      ], sink),
    });
  }

  for (const h of HOWTOS) {
    const id = nextId();
    const f = (k: string) => `howto.${h.id}.${k}`;
    files.push({
      path: `docs/${id}.md`,
      content: markdown(id, h.title, { tipo: 'guia', servico: h.service, atualizado: updated() }, [
        { heading: 'Quando usar', text: h.whenToUse },
        {
          heading: 'Passo a passo',
          text: h.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
          facts: { [f(h.stepFact.key)]: h.stepFact.value },
        },
        {
          heading: 'Limites e observações',
          text: h.limitFact.sentence,
          facts: { [f(h.limitFact.key)]: h.limitFact.value },
        },
      ], sink),
    });
  }

  return { files, facts: sink.facts };
}

/** Id do documento de cada guia/serviço, na mesma ordem usada por `renderDocs`. */
export function docIdOf(kind: 'arquitetura' | 'runbook' | 'guia', key: string): string {
  const base = kind === 'arquitetura' ? 0 : kind === 'runbook' ? SERVICES.length : 2 * SERVICES.length;
  const list = kind === 'guia' ? HOWTOS.map((h) => h.id) : SERVICES.map((s) => s.id);
  const i = list.indexOf(key);
  if (i < 0) throw new Error(`desconhecido: ${kind} ${key}`);
  return `DOC-${String(base + i + 1).padStart(3, '0')}`;
}
