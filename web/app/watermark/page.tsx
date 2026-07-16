import Shell from "@/components/shell/Shell";
import { api } from "@/lib/api";
import WatermarkClient from "./WatermarkClient";

export default async function WatermarkPage() {
  const [groups, config, library] = await Promise.all([
    api.groups.list(),
    api.watermark.getConfig(),
    api.studio.listWatermarks(),
  ]);

  return (
    <Shell
      groups={groups}
      crumbs={[{ label: "Photos" }, { label: "Вотермарк", here: true }]}
    >
      <h1 className="display display-md">Вотермарк.</h1>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 14,
          marginTop: 8,
          maxWidth: 640,
        }}
      >
        Знак накладывается на лету — при просмотре, скачивании и копировании.
        Оригиналы в хранилище остаются чистыми, включение и выключение
        моментальное для всего канала.
      </p>

      <WatermarkClient initialConfig={config} initialLibrary={library} />
    </Shell>
  );
}
