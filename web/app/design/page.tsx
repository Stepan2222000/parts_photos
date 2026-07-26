import Shell from "@/components/shell/Shell";
import { api } from "@/lib/api";
import DesignClient from "./DesignClient";

export default async function DesignPage() {
  const [groups, overview, config, library] = await Promise.all([
    api.groups.list(),
    api.backgrounds.overview(),
    api.watermark.getConfig(),
    api.studio.listWatermarks(),
  ]);

  return (
    <Shell
      groups={groups}
      crumbs={[{ label: "Photos" }, { label: "Оформление", here: true }]}
    >
      <h1 className="display display-md">Оформление.</h1>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          marginTop: 8,
          maxWidth: 640,
        }}
      >
        Единый вид каталога: генерируемый задний фон для всех фото набора и
        водяной знак поверх. Переключения мгновенные и обратимые — оригиналы в
        хранилище не меняются.
      </p>

      <DesignClient
        initialOverview={overview}
        initialConfig={config}
        initialLibrary={library}
      />
    </Shell>
  );
}
