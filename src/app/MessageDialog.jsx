import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function MessageDialog({ notice, onClose }) {
  const hasTitle = typeof notice?.title === "string" ? notice.title.trim().length > 0 : Boolean(notice?.title);
  const hasConfirmAction = typeof notice?.onAction === "function";

  function handleConfirm() {
    notice?.onAction?.();
    onClose?.();
  }

  return (
    <AlertDialog open={Boolean(notice)} onOpenChange={(open) => !open && onClose?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          {hasTitle ? <AlertDialogTitle>{notice.title}</AlertDialogTitle> : null}
          <AlertDialogDescription className="whitespace-pre-wrap">
            {notice?.description || ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={hasConfirmAction ? "!grid grid-cols-2 gap-2 sm:!grid sm:grid-cols-2 sm:justify-stretch" : undefined}>
          {hasConfirmAction ? (
            <>
              <AlertDialogAction className="text-[0.82rem]" onClick={handleConfirm}>
                {notice?.actionLabel || "是"}
              </AlertDialogAction>
              <AlertDialogCancel className="text-[0.82rem]" onClick={onClose}>
                {notice?.cancelLabel || "取消"}
              </AlertDialogCancel>
            </>
          ) : (
            <AlertDialogAction className="text-[0.82rem]" onClick={onClose}>知道了</AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
