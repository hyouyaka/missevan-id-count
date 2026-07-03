import { Component, lazy, Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const RankTrendDialog = lazy(() => import("@/app/RankTrendDialog"));

class TrendDialogErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Alert variant="destructive">
          <AlertTitle>趋势模块加载失败</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>页面资源可能已经更新，请重新加载后再试。</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
    return this.props.children;
  }
}

export function LazyRankTrendDialog({ open, fallback = null, ...props }) {
  if (!open) {
    return null;
  }
  return (
    <TrendDialogErrorBoundary>
      <Suspense fallback={fallback}>
        <RankTrendDialog open={open} {...props} />
      </Suspense>
    </TrendDialogErrorBoundary>
  );
}
