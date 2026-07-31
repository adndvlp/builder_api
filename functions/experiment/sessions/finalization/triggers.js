import { onValueWritten } from "firebase-functions/v2/database";
import { finalizeSession } from "./finalize.js";
import { scheduleResumeExpiration } from "./resume-expiration.js";
import { lookupSessionFileUrl } from "./file-url.js";
import {
  saveAbandonedNoDataMetadata,
  saveIndexedDbSessionMetadata,
} from "./trigger-metadata.js";

/**
 * Cloud Function para finalizar sesiones desconectadas automáticamente
 * Se dispara cuando se actualiza un nodo en /sessions/{experimentID}/{sessionId}
 */
export const finalizeDisconnectedSessions = onValueWritten(
  {
    ref: "/sessions/{experimentID}/{sessionId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data.before.val();
    const afterData = event.data.after.val();

    // Si no existe el nodo después del cambio, salir
    if (!afterData) {
      return null;
    }

    // Si ya fue procesado, salir inmediatamente (esto evita reprocesar)
    if (afterData.finalizationProcessed === true) {
      return null;
    }

    const experimentID = event.params.experimentID;
    const sessionId = event.params.sessionId;
    const wasConnected = beforeData?.connected === true;
    const isNowDisconnected = afterData.connected === false;
    const wasDisconnected = beforeData?.connected === false;
    const isNowConnected = afterData.connected === true;
    const useIndexedDB = afterData.useIndexedDB !== false; // Por defecto true

    // RECONEXIÓN: si la sesión vuelve a conectarse, cancelar el timeout pendiente
    // y marcar el estado como "resumed". Solo aplica donde existe un timeout
    // pendiente que cancelar:
    //   - CASO 1 (!useIndexedDB): solo OSF; Drive/Dropbox patchearon al instante
    //   - CASO 2 (useIndexedDB): cualquier provider
    if (wasDisconnected && isNowConnected) {
      const storageProvider = afterData.storageProvider || "googledrive";
      if (useIndexedDB || storageProvider === "osf") {
        console.log(`Session ${sessionId} reconnected. Invalidating timeout.`);
        await event.data.after.ref.update({
          state: "resumed",
          resumedAt: Date.now(),
          resumeExpiresAt: null,
          resumeTimeoutStarted: null,
          resumeTimeoutTaskStatus: "cancelled",
          resumeTimeoutCancelledAt: Date.now(),
        });
        return null;
      }
    }

    // CASO 1: Sesión SIN IndexedDB - manejar según storage provider (SIEMPRE con retoma)
    if (isNowDisconnected && wasConnected && !useIndexedDB) {
      const state = afterData.state;
      const storageProvider = afterData.storageProvider || "googledrive";

      // Si se desconectó pero NO finalizó
      if (state === "disconnected" && !afterData.finished) {
        console.log(
          `Session ${sessionId} disconnected without IndexedDB. Provider: ${storageProvider}`,
        );

        if (storageProvider === "osf") {
          // OSF: Iniciar contador de timeout
          console.log(
            `OSF provider: Starting timeout for session ${sessionId}...`,
          );

          const timeoutMinutes = afterData.resumeTimeoutMinutes || 30;
          const timeoutMs = timeoutMinutes * 60 * 1000;
          const expiresAt = Date.now() + timeoutMs;

          await scheduleResumeExpiration({
            ref: event.data.after.ref,
            experimentID,
            sessionId,
            expiresAt,
          });
        } else {
          // Drive/Dropbox: PATCH inmediato al desconectar
          console.log(
            `${storageProvider} provider: Sending PATCH immediately for session ${sessionId}...`,
          );

          try {
            // Enviar lo acumulado hasta ahora (PATCH o CREATE si no existe)
            // finalizeSession ya limpia Firestore automáticamente
            await finalizeSession(experimentID, sessionId);

            await event.data.after.ref.update({
              state: "partially_saved",
              lastPatchAt: Date.now(),
              finalizationProcessed: false, // Permitir otro envío si retoma
            });

            console.log(
              `Session ${sessionId} data sent to ${storageProvider} and Firestore cleaned`,
            );
          } catch (err) {
            console.error(`Error sending PATCH for ${sessionId}:`, err);

            // Marcar error pero no bloquear retoma
            await event.data.after.ref.update({
              lastPatchError: err.message,
              lastPatchErrorAt: Date.now(),
            });
          }
        }

        return null;
      }
    }

    // CASO 2: Sesión CON IndexedDB - manejar timeout (SIEMPRE con retoma)
    if (isNowDisconnected && wasConnected && useIndexedDB) {
      const state = afterData.state;

      // Si se desconectó pero NO finalizó, iniciar contador de timeout
      if (state === "disconnected" && !afterData.finished) {
        console.log(
          `Session ${sessionId} disconnected with resume enabled (IndexedDB). Starting timeout...`,
        );

        // Calcular tiempo de expiración
        const timeoutMinutes = afterData.resumeTimeoutMinutes || 30;
        const timeoutMs = timeoutMinutes * 60 * 1000;
        const expiresAt = Date.now() + timeoutMs;

        // Actualizar con tiempo de expiración
        await scheduleResumeExpiration({
          ref: event.data.after.ref,
          experimentID,
          sessionId,
          expiresAt,
        });

        return null;
      }

      // Si la sesión ya está completada o abandonada (IndexedDB/Drive guardó los datos directamente)
      if (state === "completed" || state === "abandoned") {
        const fileUrl = await lookupSessionFileUrl(experimentID, sessionId);
        await saveIndexedDbSessionMetadata({
          experimentID,
          sessionId,
          state,
          afterData,
          fileUrl,
        });

        await event.data.after.ref.update({
          finalizationProcessed: true,
          processedAt: Date.now(),
        });

        return null;
      }
    }

    // CASO 3: Finalización normal
    // Solo procesar si needsFinalization está en true
    if (afterData.needsFinalization !== true) {
      return null;
    }

    // IMPORTANTE: Solo procesar si cambió de connected=true a connected=false.
    // S-16: when the session never reached connected=true (created already
    // disconnected, then later set needsFinalization), beforeData?.connected
    // is undefined. needsFinalization is an explicit client intent — honor it
    // and still finalize.
    const wasConnectedOrInitial = wasConnected || beforeData == null;
    if (!wasConnectedOrInitial || !isNowDisconnected) {
      return null;
    }

    const isAbandoned = afterData.state === "abandoned";

    try {
      // Usar la función unificada que determina el storage provider automáticamente
      const result = await finalizeSession(experimentID, sessionId);

      // Marcar como procesado en Realtime Database
      await event.data.after.ref.update({
        finalizationProcessed: true,
        processedAt: Date.now(),
        resultsSent: result.resultsSent,
      });

      console.log(`Session ${sessionId} finalized successfully`);
      return null;
    } catch (error) {
      console.error(`Error finalizing session ${sessionId}:`, error);

      // Si el error es que no hay datos (SESSION_NOT_FOUND o NO_RESULTS),
      // también marcar como procesado para evitar reintentos
      const isNoDataError =
        error.message === "SESSION_NOT_FOUND" || error.message === "NO_RESULTS";

      // Si fue abandonado sin datos, guardar metadata de todas formas
      if (isNoDataError && isAbandoned) {
        await saveAbandonedNoDataMetadata(experimentID, sessionId, afterData);
      }

      await event.data.after.ref.update({
        finalizationProcessed: true,
        finalizationError: error.message,
        processedAt: Date.now(),
        ...(isNoDataError && { noDataToFinalize: true }),
      });

      return null;
    }
  },
);
