import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import {
  Box,
  Center,
  Spinner,
  Text,
  VStack,
  Alert,
  AlertIcon,
} from "@chakra-ui/react";

export default function GithubCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState(
    "Procesando autenticación con GitHub..."
  );

  useEffect(() => {
    const handleCallback = async () => {
      const { code, state, error } = router.query;

      // Si hay un error en la URL (el usuario rechazó el acceso)
      if (error) {
        setStatus("error");
        setMessage(`Error de GitHub: ${error}`);
        setTimeout(() => router.push("/admin/account"), 3000);
        return;
      }

      // Si no hay código, esperar a que se cargue
      if (!code || !state) {
        return;
      }

      try {
        // Llamar a la API route para intercambiar el código por tokens
        const response = await fetch(
          `/api/githubOAuthCallback?code=${code}&state=${state}`
        );

        if (response.ok) {
          setStatus("success");
          setMessage("¡GitHub conectado exitosamente! Redirigiendo...");
          setTimeout(() => router.push("/admin/account"), 2000);
        } else {
          const errorText = await response.text();
          setStatus("error");
          setMessage(`Error al guardar tokens: ${errorText}`);
          setTimeout(() => router.push("/admin/account"), 3000);
        }
      } catch (err) {
        setStatus("error");
        setMessage(`Error de conexión: ${err.message}`);
        setTimeout(() => router.push("/admin/account"), 3000);
      }
    };

    if (router.isReady) {
      handleCallback();
    }
  }, [router, router.isReady, router.query]);

  return (
    <Center h="100vh">
      <VStack spacing={4}>
        {status === "loading" && <Spinner size="xl" color="brandTeal.500" />}
        {status === "success" && (
          <Alert status="success" borderRadius="md">
            <AlertIcon />
            {message}
          </Alert>
        )}
        {status === "error" && (
          <Alert status="error" borderRadius="md">
            <AlertIcon />
            {message}
          </Alert>
        )}
        {status === "loading" && (
          <Text fontSize="lg" color="gray.600">
            {message}
          </Text>
        )}
      </VStack>
    </Center>
  );
}
