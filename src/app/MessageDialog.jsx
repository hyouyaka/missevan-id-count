import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function MessageDialog({ notice, onClose }) {
  const hasTitle = typeof notice?.title === "string" ? notice.title.trim().length > 0 : Boolean(notice?.title);

  return (
    <AlertDialog open={Boolean(notice)} onOpenChange={(open) => !open && onClose?.()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          {hasTitle ? <AlertDialogTitle>{notice.title}</AlertDialogTitle> : null}
          <AlertDialogDescription className="whitespace-pre-wrap">
            {notice?.description || ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className="text-[0.82rem]" onClick={onClose}>知道了</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
