document.addEventListener("DOMContentLoaded", () => {
  const year = document.getElementById("year");

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  const assistantToggle = document.getElementById("assistant-toggle");
  const assistantClose = document.getElementById("assistant-close");
  const assistantPanel = document.getElementById("assistant-panel");
  const assistantForm = document.getElementById("assistant-form");
  const assistantInput = document.getElementById("assistant-input");
  const assistantMessages = document.getElementById("assistant-messages");
  const assistantOptions = document.getElementById("assistant-options");
  const contactForm = document.getElementById("contact-form");
  const assistantWhatsapp = document.querySelector(".assistant-whatsapp");
  const contactStatus = document.getElementById("contact-status");

  const readApiResponse = async (response) => {
    const responseText = await response.text();
    if (!responseText.trim()) {
      throw new Error("The server returned an empty response. Please try again in a moment.");
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error("The server returned an unreadable response. Please try again or contact us directly.");
    }

    if (!response.ok) {
      throw new Error(result.error || "The request could not be completed.");
    }
    return result;
  };

  const starRatings = document.querySelectorAll(".testimonial-card .stars");

  const replayStarShine = () => {
    starRatings.forEach((rating) => {
      rating.classList.remove("swing-once");
      void rating.offsetWidth;
      rating.classList.add("swing-once");
    });
  };

  if (starRatings.length) {
    replayStarShine();
    window.addEventListener("pageshow", replayStarShine);
  }

  if (contactForm && contactStatus) {
    contactForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!contactForm.reportValidity()) {
        return;
      }

      const submitButton = contactForm.querySelector('button[type="submit"]');
      const originalButtonText = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
      contactStatus.textContent = "";
      contactStatus.dataset.state = "";

      try {
        const response = await fetch(contactForm.action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(contactForm)))
        });
        const result = await readApiResponse(response);

        contactForm.reset();
        contactStatus.textContent = result.message;
        contactStatus.dataset.state = "success";
      } catch (error) {
        console.error("Unable to send website enquiry:", error);
        contactStatus.textContent = error instanceof Error
          ? error.message
          : "Your enquiry could not be sent. Please try WhatsApp or email.";
        contactStatus.dataset.state = "error";
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    });
  }

  if (!assistantToggle || !assistantPanel || !assistantForm || !assistantInput || !assistantMessages) {
    return;
  }

  const addMessage = (message, type) => {
    const element = document.createElement("div");
    element.className = `assistant-message assistant-message-${type}`;
    element.textContent = message;
    assistantMessages.appendChild(element);
    assistantMessages.scrollTop = assistantMessages.scrollHeight;
  };

  const submitQuestion = async (question) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) {
      return;
    }
    addMessage(cleanQuestion, "user");
    if (assistantWhatsapp) {
      const whatsappMessage = `Hello Ofentse, I have a website question: ${cleanQuestion}`;
      assistantWhatsapp.href = `https://wa.me/27798848721?text=${encodeURIComponent(whatsappMessage)}`;
    }
    assistantInput.value = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cleanQuestion })
      });
      const result = await readApiResponse(response);
      addMessage(result.reply, "bot");
    } catch (error) {
      console.error("Unable to get an assistant response:", error);
      addMessage(
        "I couldn't connect just now. Please use the contact form, email, or WhatsApp to reach Elevate Digital.",
        "bot"
      );
    }
  };

  assistantToggle.addEventListener("click", () => {
    const isOpen = !assistantPanel.hidden;
    assistantPanel.hidden = isOpen;
    assistantToggle.setAttribute("aria-expanded", String(!isOpen));
    if (isOpen) {
      assistantInput.blur();
    } else {
      assistantInput.focus();
    }
  });

  assistantClose.addEventListener("click", () => {
    assistantPanel.hidden = true;
    assistantToggle.setAttribute("aria-expanded", "false");
  });

  assistantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion(assistantInput.value);
  });

  assistantOptions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-question]");
    if (button) {
      submitQuestion(button.dataset.question);
    }
  });
});
