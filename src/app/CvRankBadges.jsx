import { selectCvRankBadges } from "../../shared/cvRankBadges.js";
import { formatDeviceDateTime } from "@/app/app-utils";
import { Badge } from "@/components/ui/badge";

const platformVariants = {
  missevan: "missevanPlatformSoft",
  manbo: "manboPlatformSoft",
};

const combinedRankVariants = {
  "combined:cv": "infoSoft",
  "combined:cv-paid": "paidSoft",
  "combined:cv-series-count": "successSoft",
};

export function CvRankBadges({ cvRanks }) {
  return (
    <div aria-label="CV榜排名" className="flex max-w-full flex-wrap gap-1.5">
      {selectCvRankBadges(cvRanks?.items).map(({ key, platform, label, rank, updatedAt }) => {
        const timestamp = updatedAt || cvRanks?.updatedAtByPlatform?.[platform] || cvRanks?.updatedAt;
        return (
          <Badge
            key={key}
            variant={platformVariants[platform] || combinedRankVariants[key] || "outline"}
            title={timestamp || rank != null ? "榜单更新时间：" + (timestamp ? formatDeviceDateTime(timestamp) : "暂无数据") : undefined}
          >
            {label}{rank != null ? " #" + rank : ""}
          </Badge>
        );
      })}
    </div>
  );
}
