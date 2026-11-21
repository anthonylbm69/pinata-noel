import { Suspense } from "react";
import HostScreen from "./HostScreen";

// Le code de partie n'est connu qu'à l'exécution : on le lit sous <Suspense>.
async function WithCode({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostScreen code={code.replace(/\D/g, "")} />;
}

export default function Page({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<div className="text-xgrey flex min-h-dvh items-center justify-center text-2xl">Chargement…</div>}>
      <WithCode params={params} />
    </Suspense>
  );
}
