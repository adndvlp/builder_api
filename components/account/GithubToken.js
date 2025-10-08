import { useState, useContext } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { UserContext } from "../../lib/context";
import { HStack, Button, Text, Tooltip } from "@chakra-ui/react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { db } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon } from "@chakra-ui/icons";

export default function GithubToken() {
  const { user } = useContext(UserContext);
  const [data] = useDocumentData(doc(db, "users", user.uid));

  // Parámetros de GitHub OAuth
  const CLIENT_ID = "Ov23limim0vbyTd5J4fK";
  const REDIRECT_URI = "http://localhost:3000/github-callback"; // Debe coincidir con el backend y GitHub Console
  // const REDIRECT_URI = "https://test-e4cf9.firebaseapp.com/github-callback"; // Para producción

  // Scopes de GitHub que necesitas
  const SCOPE = "repo delete_repo workflow";
  // El UID se pasa como parámetro para asociar el token al usuario
  const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&scope=${encodeURIComponent(SCOPE)}&state=${user?.uid}`;

  // Función para borrar el token de GitHub
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDeleteToken = async () => {
    setIsDeleting(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        githubTokens: null,
      });
    } catch (err) {
      console.error("Error deleting GitHub token:", err);
    }
    setIsDeleting(false);
  };

  return (
    <HStack justifyContent="space-between" w="100%">
      <HStack>
        <Text fontSize={"lg"}>GitHub Token</Text>
        {data && data.githubTokens ? (
          <Tooltip label="Valid GitHub Token">
            <CheckCircleIcon color="brandTeal.500" />
          </Tooltip>
        ) : (
          <Tooltip label="No válido o no conectado">
            <WarningIcon color="brandOrange.500" />
          </Tooltip>
        )}
      </HStack>
      {data && data.githubTokens ? (
        <Button
          colorScheme="red"
          isLoading={isDeleting}
          onClick={handleDeleteToken}
        >
          Desconectar GitHub
        </Button>
      ) : (
        <Button
          as="a"
          href={oauthUrl}
          colorScheme="brandTeal"
          target="_blank"
          rel="noopener noreferrer"
        >
          Conectar GitHub
        </Button>
      )}
    </HStack>
  );
}
