"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Attachment,
  fileAccept,
  MAX_FILES,
  sizeLabel,
} from "@/lib/attachment-rules";
import { attachmentApi, uploadAttachment } from "@/lib/attachments-client";
export function TaskAttachments({
  taskId,
  editable,
}: {
  taskId: string;
  editable: boolean;
}) {
  const [files, setFiles] = useState<Attachment[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [local, setLocal] = useState(false),
    [removing, setRemoving] = useState<Attachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await attachmentApi({}, "?task=" + taskId);
      setFiles(result.files);
      setLocal(result.local);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 240000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="relative min-w-0 rounded-xl border p-2"
            >
              <a
                className="block"
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {file.preview_url ? (
                  <img
                    src={file.preview_url}
                    alt={file.name}
                    loading="lazy"
                    className="h-24 w-full rounded-lg object-cover"
                  />
                ) : (
                  <FileText className="my-3 size-7 text-muted-foreground" />
                )}
                <p className="mt-2 truncate text-sm pr-5">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {sizeLabel(file.size_bytes)}
                </p>
              </a>
              {editable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute bottom-1 right-0 size-8"
                  aria-label={"Удалить " + file.name}
                  disabled={busy}
                  onClick={() => setRemoving(file)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <Button
          variant="ghost"
          onClick={() => void refresh()}
          className="h-auto whitespace-normal text-destructive"
        >
          {error} · Повторить
        </Button>
      )}
      {editable && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept={fileAccept}
            className="hidden"
            onChange={async (e) => {
              const picked = Array.from(e.target.files || []);
              e.target.value = "";
              if (picked.length + files.length > MAX_FILES) {
                toast.error("До 6 файлов на задание");
                return;
              }
              setBusy(true);
              for (const file of picked) {
                try {
                  setProgress(0);
                  await uploadAttachment(taskId, file, setProgress);
                } catch (err) {
                  toast.error(file.name + ": " + (err as Error).message);
                }
              }
              await refresh();
              setBusy(false);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-9 px-2 font-normal text-muted-foreground"
            disabled={busy || files.length >= MAX_FILES}
            onClick={() => input.current?.click()}
          >
            <Paperclip />
            {busy
              ? "Загружаем…"
              : files.length
                ? "Добавить файл"
                : "Фото или документ"}
          </Button>
          {busy && <Progress value={progress} />}
          {local && files.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Хранятся на сервере приложения и пропадут при деплое.
            </p>
          )}
        </>
      )}
      <AlertDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить файл?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.name} исчезнет для всех участников.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!removing) return;
                setBusy(true);
                try {
                  await attachmentApi({
                    method: "DELETE",
                    body: JSON.stringify({ id: removing.id }),
                  });
                  await refresh();
                } catch {
                  toast.error("Не удалось удалить файл");
                } finally {
                  setBusy(false);
                  setRemoving(null);
                }
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
