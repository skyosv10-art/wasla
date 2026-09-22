import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

interface ReputationScore {
  subject_public_id: string;
  subject_type: string;
  score: number;
  level: string;
  updated_at: string;
}

interface Rating {
  rating_id: string;
  order_public_id: string;
  stars: number;
  comment?: string;
  created_at: string;
}

export function Reputation() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [score, setScore] = useState<ReputationScore | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadReputation = useCallback(async () => {
    if (!token || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      const scoreResult = await apiClient.get<ReputationScore>(
        `/reputation/scores/customer/${customerId}`
      );
      setScore(scoreResult);

      const ratingsResult = await apiClient.get<{ items: Rating[]; limit: number }>(
        `/reputation/ratings?subjectPublicId=${customerId}`
      );
      setRatings(ratingsResult.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadReputation();
  }, [loadReputation]);

  if (loading && !score) {
    return (
      <div className="screen reputation-screen">
        <h1>{t("reputation.title")}</h1>
        <div className="loading-indicator" data-testid="reputation-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (error && !score) {
    return (
      <div className="screen reputation-screen">
        <h1>{t("reputation.title")}</h1>
        <div className="error-message" role="alert" data-testid="reputation-error">
          {t(`errors.${error}`)}
        </div>
      </div>
    );
  }

  return (
    <div className="screen reputation-screen">
      <h1>{t("reputation.title")}</h1>

      {score && (
        <div className="score-card" data-testid="reputation-score">
          <div className="score-value" data-testid="score-value">{score.score}</div>
          <div className="score-level" data-testid="score-level">
            {t(`reputation.level_${score.level}`)}
          </div>
        </div>
      )}

      <h2>{t("reputation.ratings_title")}</h2>

      {ratings.length === 0 && !loading && (
        <div className="empty-state" data-testid="ratings-empty">
          {t("reputation.no_ratings")}
        </div>
      )}

      {ratings.length > 0 && (
        <ul className="ratings-list" data-testid="ratings-list">
          {ratings.map((rating) => (
            <li key={rating.rating_id} className="rating-item" data-testid={`rating-${rating.rating_id}`}>
              <div className="rating-stars" data-testid={`stars-${rating.rating_id}`}>
                {"★".repeat(rating.stars)}
                {"☆".repeat(5 - rating.stars)}
              </div>
              {rating.comment && (
                <span className="rating-comment">{rating.comment}</span>
              )}
              <span className="rating-order">{rating.order_public_id}</span>
              <span className="rating-date">{new Date(rating.created_at).toLocaleDateString("ar-SA")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
